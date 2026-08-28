import type { Logger } from "@taxgenie/shared";

export class ClaimOwnershipLostError extends Error {
  constructor(message = "Worker event claim ownership was lost.") {
    super(message);
    this.name = "ClaimOwnershipLostError";
  }
}

export interface ClaimLeaseHeartbeatInput {
  renew: () => Promise<Date | null>;
  initialLeaseExpiresAt: Date;
  heartbeatIntervalMs: number;
  logger: Logger;
  context: {
    eventId: string;
    jobId: string;
    claimOwner: string;
    attemptNumber: number;
  };
  onOwnershipLost: (error: ClaimOwnershipLostError) => void;
  retryDelayMs?: number;
  now?: () => number;
}

export interface ClaimLeaseHeartbeat {
  hasLostOwnership(): boolean;
  stop(): Promise<void>;
}

export function startClaimLeaseHeartbeat(
  input: ClaimLeaseHeartbeatInput,
): ClaimLeaseHeartbeat {
  const now = input.now ?? Date.now;
  const retryDelayMs = input.retryDelayMs ?? 5_000;
  let lastKnownLeaseExpiresAt = input.initialLeaseExpiresAt.getTime();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let ownershipLost = false;

  const markOwnershipLost = (message: string) => {
    if (ownershipLost || stopped) {
      return;
    }

    ownershipLost = true;
    const error = new ClaimOwnershipLostError(message);
    input.logger.error("Worker claim ownership lost", {
      ...input.context,
      leaseExpiresAt: new Date(lastKnownLeaseExpiresAt).toISOString(),
    });
    input.onOwnershipLost(error);
  };

  const schedule = (delayMs: number) => {
    if (stopped || ownershipLost) {
      return;
    }

    timer = setTimeout(() => {
      inFlight = tick();
    }, delayMs);
  };

  const tick = async () => {
    try {
      const renewedLeaseExpiresAt = await input.renew();
      if (!renewedLeaseExpiresAt) {
        markOwnershipLost(
          "Worker event claim could not be renewed because this attempt no longer owns it.",
        );
        return;
      }

      lastKnownLeaseExpiresAt = renewedLeaseExpiresAt.getTime();
      schedule(input.heartbeatIntervalMs);
    } catch (error) {
      input.logger.warn("Worker claim heartbeat failed", {
        ...input.context,
        error: error instanceof Error ? error.message : String(error),
        leaseExpiresAt: new Date(lastKnownLeaseExpiresAt).toISOString(),
      });

      if (now() >= lastKnownLeaseExpiresAt) {
        markOwnershipLost(
          "Worker event claim expired after repeated heartbeat failures.",
        );
        return;
      }

      schedule(
        Math.min(retryDelayMs, Math.max(1, lastKnownLeaseExpiresAt - now())),
      );
    }
  };

  schedule(input.heartbeatIntervalMs);

  return {
    hasLostOwnership: () => ownershipLost,
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      await inFlight;
    },
  };
}
