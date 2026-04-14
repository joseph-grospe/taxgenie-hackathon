import type { S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { CallbackHandler } from "langfuse-langchain";
import {
  createLogger,
  QueueMessageSchema,
  type DocumentIngestEventV1,
  type Logger,
  type WorkerEnv
} from "@taxtrack/shared";
import type { DbClient } from "../db/client";
import { refreshBatchStatus } from "../db/progress";
import { intakeFiles, workerIdempotency, workerJobs, workerJobSteps } from "../db/schema";
import { createWorkflowGraph } from "../langgraph/graph";
import type { WorkflowState, WorkflowOutcome } from "../langgraph/types";
import { buildWorkflowConfig } from "../langgraph/services/workflowConfig";
import type { MistralConfig } from "../langgraph/services/mistralClient";
import type { NormalizerConfig } from "../langgraph/services/azureNormalizerClient";

interface MessageHandlerDeps {
  db: DbClient;
  s3: S3Client;
  env: WorkerEnv;
  logger?: Logger;
}

type TerminalWorkerStatus = "success" | "error" | "duplicate";

const terminalIdempotencyStates = new Set(["success", "error", "duplicate", "Done", "Error", "Duplicate"]);

function mapTerminalState(outcome: WorkflowOutcome | undefined): TerminalWorkerStatus {
  switch (outcome) {
    case "Duplicate":
      return "duplicate";
    case "Error":
      return "error";
    default:
      return "success";
  }
}

function idempotencyKey(event: DocumentIngestEventV1): string {
  return event.eventId;
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  const logger = deps.logger ?? createLogger({ component: "worker-message-handler" });
  const workflowConfig = buildWorkflowConfig(deps.env);
  const mistralConfig: MistralConfig = {
    apiKey: deps.env.MISTRAL_API_KEY ?? deps.env.AZURE_API_KEY ?? "",
    apiUrl: deps.env.MISTRAL_API_URL,
    model: deps.env.MISTRAL_MODEL,
    timeoutMs: deps.env.MISTRAL_TIMEOUT_MS,
    logger
  };
  const azureConfig: Omit<NormalizerConfig, "logger"> = {
    apiKey: deps.env.AZURE_OPENAI_API_KEY ?? "",
    endpoint: deps.env.AZURE_OPENAI_ENDPOINT ?? "",
    deploymentName: deps.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    apiVersion: deps.env.AZURE_OPENAI_API_VERSION,
    timeoutMs: deps.env.AZURE_OPENAI_TIMEOUT_MS
  };

  const workflow = createWorkflowGraph({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.env.S3_BUCKET,
    logger,
    workflowConfig,
    mistralConfig,
    azureConfig,
    sourceBucket: deps.env.S3_SOURCE_BUCKET ?? deps.env.S3_BUCKET
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

    if (terminalIdempotencyStates.has(existing[0]?.terminalState ?? "")) {
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
      batchId: event.batchId,
      uploadId: event.uploadId,
      source: event.source,
      originalFileName: event.originalFileName,
      mimeType: event.mimeType,
      sizeBytes: event.sizeBytes,
      status: "processing",
      currentPhase: "extract",
      currentStep: "load_input",
      attempts: 1,
      startedAt: new Date()
    });

    await deps.db
      .update(intakeFiles)
      .set({
        sourceFileId: event.sourceFileId,
        revision: event.revision,
        eventId: event.eventId,
        traceId: event.traceId,
        artifactUri: event.artifactUri,
        queueStatus: "queued",
        processingStatus: "processing",
        currentPhase: "extract",
        currentStep: "load_input",
        processingStartedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(intakeFiles.id, event.uploadId));

    await refreshBatchStatus(deps.db, event.batchId);

    try {
      const result = (await workflow.invoke({ event, jobId }, {
        callbacks: langfuseHandler ? [langfuseHandler] : [],
        runName: `worker-workflow:${jobId}`,
        metadata: {
          jobId,
          eventId: event.eventId,
          sourceFileId: event.sourceFileId,
          revision: event.revision
        }
      })) as WorkflowState;

      const terminalStatus: WorkflowOutcome = result.decision?.terminalStatus ?? "Error";
      const terminalJobStatus = mapTerminalState(terminalStatus);

      await deps.db
        .update(workerJobs)
        .set({
          status: terminalJobStatus,
          currentPhase: result.decision?.phase ?? "persist",
          currentStep: "complete",
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(workerJobs.jobId, jobId));

      await deps.db
        .update(workerIdempotency)
        .set({
          terminalState: terminalStatus,
          updatedAt: new Date()
        })
        .where(eq(workerIdempotency.idempotencyKey, idemKey));

      await deps.db
        .update(intakeFiles)
        .set({
          processingStatus: terminalJobStatus,
          currentPhase: result.decision?.phase ?? "persist",
          currentStep: "complete",
          processingFinishedAt: new Date(),
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(intakeFiles.id, event.uploadId));

      await refreshBatchStatus(deps.db, event.batchId);

      await deps.db.insert(workerJobSteps).values({
        jobId,
        stepName: "workflow",
        status: terminalJobStatus,
        metadata: {
          eventId: event.eventId,
          terminalOutcome: terminalStatus,
          reasonCodes: result.decision?.reasonCodes ?? []
        }
      });
    } catch (error) {
      await deps.db
        .update(workerJobs)
        .set({
          status: "failed",
          currentStep: "workflow_failed",
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

      await deps.db
        .update(intakeFiles)
        .set({
          processingStatus: "error",
          currentStep: "workflow_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(intakeFiles.id, event.uploadId));

      await refreshBatchStatus(deps.db, event.batchId);

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

  if (isSelfReferentialLangfuseHost(host, env.WORKER_PORT)) {
    logger.warn("Langfuse callback disabled because host points to the worker itself", {
      host,
      workerPort: env.WORKER_PORT
    });
    return null;
  }

  return new CallbackHandler({
    publicKey,
    secretKey,
    ...(host ? { baseUrl: host } : {})
  }
  );
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

function isSelfReferentialLangfuseHost(host: string | undefined, workerPort: number): boolean {
  if (!host) {
    return false;
  }

  try {
    const parsed = new URL(host);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const port = parsed.port.length > 0 ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;

    return isLoopback && port === workerPort;
  } catch {
    return false;
  }
}
