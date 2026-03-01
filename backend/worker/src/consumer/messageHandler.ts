import { createHash } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { CallbackHandler } from "@langfuse/langchain";
import {
  createLogger,
  QueueMessageSchema,
  type DriveFileEventV1,
  type Logger,
  type WorkerEnv
} from "@taxtrack/shared";
import type { DbClient } from "../db/client";
import { workerIdempotency, workerJobs, workerJobSteps } from "../db/schema";
import { createWorkflowGraph } from "../langgraph/graph";

interface MessageHandlerDeps {
  db: DbClient;
  s3: S3Client;
  env: WorkerEnv;
  logger?: Logger;
}

function idempotencyKey(event: DriveFileEventV1): string {
  return createHash("sha256").update(`${event.sourceFileId}:${event.revision}:${event.modifiedTime}`).digest("hex");
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  const logger = deps.logger ?? createLogger({ component: "worker-message-handler" });
  const workflow = createWorkflowGraph({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.env.S3_BUCKET,
    logger
  });
  const langfuseHandler = createLangfuseCallbackHandler(deps.env, logger);

  return async (rawBody: string): Promise<void> => {
    const parsed = QueueMessageSchema.parse(JSON.parse(rawBody));
    const event = parsed.event;
    const idemKey = idempotencyKey(event);

    const existing = await deps.db
      .select()
      .from(workerIdempotency)
      .where(eq(workerIdempotency.idempotencyKey, idemKey))
      .limit(1);

    if (existing[0]?.terminalState === "success") {
      logger.info("Skipping already-processed message", {
        eventId: event.eventId,
        idempotencyKey: idemKey
      });
      return;
    }

    const jobId = `job_${event.eventId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}`;

    await deps.db
      .insert(workerIdempotency)
      .values({
        idempotencyKey: idemKey,
        jobId,
        terminalState: "pending"
      })
      .onConflictDoNothing();

    await deps.db.insert(workerJobs).values({
      jobId,
      eventId: event.eventId,
      status: "processing",
      attempts: 1,
      startedAt: new Date()
    });

    try {
      await workflow.invoke({ event, jobId }, {
        callbacks: langfuseHandler ? [langfuseHandler] : [],
        runName: `worker-workflow:${jobId}`,
        metadata: {
          jobId,
          eventId: event.eventId,
          sourceFileId: event.sourceFileId,
          revision: event.revision
        }
      });

      await deps.db
        .update(workerJobs)
        .set({
          status: "success",
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(workerJobs.jobId, jobId));

      await deps.db
        .update(workerIdempotency)
        .set({
          terminalState: "success",
          updatedAt: new Date()
        })
        .where(eq(workerIdempotency.idempotencyKey, idemKey));

      await deps.db.insert(workerJobSteps).values({
        jobId,
        stepName: "workflow",
        status: "success",
        metadata: {
          eventId: event.eventId
        }
      });
    } catch (error) {
      await deps.db
        .update(workerJobs)
        .set({
          status: "failed",
          errorSummary: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(workerJobs.jobId, jobId));

      await deps.db
        .update(workerIdempotency)
        .set({
          terminalState: "failed",
          updatedAt: new Date()
        })
        .where(eq(workerIdempotency.idempotencyKey, idemKey));

      await deps.db.insert(workerJobSteps).values({
        jobId,
        stepName: "workflow",
        status: "failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      });

      throw error;
    }
  };
}

function createLangfuseCallbackHandler(env: WorkerEnv, logger: Logger): CallbackHandler | null {
  const enabled = normalizeEnabled(env.LANGFUSE_ENABLED ?? env.TAXTRACK_LANGFUSE_ENABLED);
  if (!enabled) {
    return null;
  }

  const publicKey = env.LANGFUSE_PUBLIC_KEY ?? env.TAXTRACK_LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY ?? env.TAXTRACK_LANGFUSE_SECRET_KEY;
  const host = env.LANGFUSE_HOST ?? env.TAXTRACK_LANGFUSE_HOST;

  if (!publicKey || !secretKey) {
    logger.warn("Langfuse callback disabled because Langfuse public/secret keys are missing");
    return null;
  }

  process.env.LANGFUSE_PUBLIC_KEY = publicKey;
  process.env.LANGFUSE_SECRET_KEY = secretKey;
  if (host) {
    process.env.LANGFUSE_HOST = host;
    process.env.LANGFUSE_BASE_URL = host;
  }

  return new CallbackHandler();
}

function normalizeEnabled(value: boolean | string | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() !== "false" && value !== "0" && value.toLowerCase() !== "off";
  }

  return true;
}
