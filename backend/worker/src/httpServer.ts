import express, { type Express } from "express";
import type { Logger } from "@taxgenie/shared";
import type { Pool } from "pg";
import type { MessageDisposition } from "./consumer/messageDisposition";

export type ProcessTask = (rawBody: string) => Promise<MessageDisposition>;

export function createWorkerHttpServer(input: {
  processTask: ProcessTask;
  pool: Pick<Pool, "query">;
  logger: Logger;
}): Express {
  const app = express();
  app.use(express.text({ type: "application/json", limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await input.pool.query("SELECT 1");
      res.status(200).json({ ok: true, ready: true });
    } catch (error) {
      input.logger.warn("worker_readiness_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({ ok: false, ready: false });
    }
  });

  app.post("/tasks/document-extraction", async (req, res) => {
    try {
      const disposition = await input.processTask(
        typeof req.body === "string" ? req.body : "",
      );
      if (disposition.kind === "retry") {
        res.status(503).json({ error: "retryable", reason: disposition.reason });
        return;
      }
      if (disposition.kind === "poison") {
        input.logger.warn("document_task_poison_acknowledged", {
          reason: disposition.reason,
          validationIssues: disposition.validationIssues,
        });
      }
      res.status(204).end();
    } catch (error) {
      input.logger.error("document_task_unexpected_failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return app;
}
