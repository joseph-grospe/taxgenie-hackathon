import type { Logger } from "@taxtrack/shared";
import type { MessageDisposition } from "../consumer/sqsPoller";
import {
  parsePersistenceEvent,
  type ResultPersistenceService,
} from "./resultPersistence";

interface PersistenceReconcilerDeps {
  persistence: ResultPersistenceService;
  processMessage: (body: string) => Promise<MessageDisposition>;
  logger: Logger;
  enabled: boolean;
  intervalMs: number;
  batchSize?: number;
}

export class PersistenceReconciler {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly deps: PersistenceReconcilerDeps) {}

  start(): void {
    if (!this.deps.enabled || this.active) {
      return;
    }
    this.active = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  async runOnce(): Promise<void> {
    await this.sweep(false);
  }

  private schedule(delayMs: number): void {
    if (!this.active) {
      return;
    }
    this.timer = setTimeout(() => {
      this.inFlight = this.sweep().finally(() => {
        this.inFlight = undefined;
        this.schedule(this.deps.intervalMs);
      });
    }, delayMs);
  }

  private async sweep(stopWhenInactive = true): Promise<void> {
    try {
      const backlog = await this.deps.persistence.getBacklog();
      const oldestAgeSeconds = backlog.oldestCreatedAt
        ? Math.max(
            0,
            Math.round(
              (Date.now() - backlog.oldestCreatedAt.getTime()) / 1_000,
            ),
          )
        : 0;
      this.deps.logger.info("persistence_reconcile_backlog", {
        count: backlog.count,
        oldestAgeSeconds,
      });

      const operations = await this.deps.persistence.listEligible(
        this.deps.batchSize ?? 5,
      );
      for (const operation of operations) {
        if (stopWhenInactive && !this.active) {
          return;
        }
        let event;
        try {
          event = parsePersistenceEvent(operation);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await this.deps.persistence.blockInvalidIntent(operation.id, reason);
          continue;
        }
        try {
          const disposition = await this.deps.processMessage(
            JSON.stringify({ event }),
          );
          this.deps.logger.info("persistence_reconcile_disposition", {
            operationId: operation.id,
            eventId: operation.eventId,
            disposition: disposition.kind,
          });
        } catch (error) {
          this.deps.logger.warn("persistence_reconcile_attempt_failed", {
            operationId: operation.id,
            eventId: operation.eventId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      this.deps.logger.error("persistence_reconcile_sweep_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
