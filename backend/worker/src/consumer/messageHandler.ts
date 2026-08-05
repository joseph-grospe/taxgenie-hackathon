import type { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { CallbackHandler } from "langfuse-langchain";
import {
  buildCertificateMetadataFields,
  createLogger,
  QueueMessageSchema,
  type DocumentIngestEventV1,
  type Logger,
  type WorkerEnv,
} from "@taxtrack/shared";
import type { DbClient } from "../db/client";
import {
  documentExtractionAttempts,
  intakeBatches,
  intakeFiles,
  workerJobs,
  workerJobSteps,
} from "../db/schema";
import {
  workerIdempotencyRepository,
  type WorkerEventClaim,
  type WorkerIdempotencyRepository,
} from "../db/workerIdempotency";
import { createWorkflowGraph } from "../langgraph/graph";
import type { WorkflowState, WorkflowOutcome } from "../langgraph/types";
import { buildWorkflowConfig } from "../langgraph/services/workflowConfig";
import { resolveGeminiConfig } from "../langgraph/services/geminiConfig";
import {
  ClaimOwnershipLostError,
  startClaimLeaseHeartbeat,
} from "./claimLeaseHeartbeat";
import type { MessageDisposition } from "./sqsPoller";

type WorkflowInvoker = Pick<ReturnType<typeof createWorkflowGraph>, "invoke">;

interface MessageHandlerDeps {
  db: DbClient;
  s3: S3Client;
  env: WorkerEnv;
  logger?: Logger;
  workflow?: WorkflowInvoker;
  idempotencyRepository?: WorkerIdempotencyRepository;
  createAttemptId?: () => string;
  startLeaseHeartbeat?: typeof startClaimLeaseHeartbeat;
}

type TerminalWorkerStatus = "success" | "error" | "duplicate";

const manualRetryRevisionPattern = /^manual-retry-([1-9]\d*)-/u;

function toExtractionAttemptTrigger(revision: string): {
  trigger: "initial" | "manual_retry";
  retryNumber: number;
} {
  const match = revision.match(manualRetryRevisionPattern);
  return match
    ? {
        trigger: "manual_retry",
        retryNumber: Number.parseInt(match[1], 10),
      }
    : { trigger: "initial", retryNumber: 0 };
}

function mapTerminalState(
  outcome: WorkflowOutcome | undefined,
): TerminalWorkerStatus {
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
  const logger =
    deps.logger ?? createLogger({ component: "worker-message-handler" });
  const idempotencyRepository =
    deps.idempotencyRepository ?? workerIdempotencyRepository;
  const createAttemptId = deps.createAttemptId ?? randomUUID;
  const startLeaseHeartbeat =
    deps.startLeaseHeartbeat ?? startClaimLeaseHeartbeat;
  const leaseDurationSeconds = deps.env.SQS_VISIBILITY_TIMEOUT_SECONDS;
  const heartbeatIntervalMs = Math.max(
    1_000,
    Math.floor((leaseDurationSeconds * 1_000) / 3),
  );
  const workflowConfig = buildWorkflowConfig(deps.env);
  const geminiConfig = resolveGeminiConfig(deps.env);
  logger.info("Gemini extraction configured", {
    provider: "gemini",
    model: geminiConfig.model,
  });
  const workflow =
    deps.workflow ??
    createWorkflowGraph({
      db: deps.db,
      s3: deps.s3,
      bucket: deps.env.S3_BUCKET_NAME,
      logger,
      workflowConfig,
      geminiConfig,
      sourceBucket: deps.env.S3_BUCKET_NAME,
    });
  const langfuseHandler = createLangfuseCallbackHandler(deps.env, logger);

  return async (rawBody: string): Promise<MessageDisposition> => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody);
    } catch {
      return { kind: "poison", reason: "invalid_json" };
    }

    const parseResult = QueueMessageSchema.safeParse(decoded);
    if (!parseResult.success) {
      return {
        kind: "poison",
        reason: "invalid_event_schema",
        validationIssues: parseResult.error.issues.map((issue) => ({
          code: issue.code,
          path:
            issue.path.map((segment) => String(segment)).join(".") || "<root>",
        })),
      };
    }

    const parsed = parseResult.data;
    const event = parsed.event;
    const idemKey = idempotencyKey(event);
    const attemptId = createAttemptId();
    const jobId = `job_${attemptId}`;
    const claimResult = await idempotencyRepository.claim(deps.db, {
      idempotencyKey: idemKey,
      claimOwner: attemptId,
      jobId,
      leaseDurationSeconds,
    });

    if (claimResult.kind === "terminal_replay") {
      logger.info("Acknowledging terminal worker event replay", {
        eventId: event.eventId,
        idempotencyKey: idemKey,
        terminalState: claimResult.terminalState,
        jobId: claimResult.jobId,
      });
      return { kind: "acknowledge" };
    }

    if (claimResult.kind === "busy") {
      logger.info("Deferring worker event with a live claim", {
        eventId: event.eventId,
        idempotencyKey: idemKey,
        terminalState: claimResult.terminalState,
        claimOwner: claimResult.claimOwner,
        leaseExpiresAt: claimResult.leaseExpiresAt?.toISOString() ?? null,
      });
      return { kind: "retry", reason: "claim_busy" };
    }

    const { claim } = claimResult;
    logger.info(
      claimResult.takeover
        ? "Acquired expired worker event claim"
        : "Acquired worker event claim",
      {
        eventId: event.eventId,
        idempotencyKey: idemKey,
        jobId: claim.jobId,
        claimOwner: claim.claimOwner,
        attemptNumber: claim.attemptNumber,
        leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
      },
    );

    let jobInitialized = false;
    let extractionAttemptId: number | null = null;
    let ownershipLostError: ClaimOwnershipLostError | null = null;
    let heartbeat: ReturnType<typeof startClaimLeaseHeartbeat> | undefined;
    const abortController = new AbortController();

    try {
      heartbeat = startLeaseHeartbeat({
        renew: () =>
          idempotencyRepository.renew(deps.db, claim, leaseDurationSeconds),
        initialLeaseExpiresAt: claim.leaseExpiresAt,
        heartbeatIntervalMs,
        logger,
        context: {
          eventId: event.eventId,
          jobId: claim.jobId,
          claimOwner: claim.claimOwner,
          attemptNumber: claim.attemptNumber,
        },
        onOwnershipLost: (error) => {
          ownershipLostError = error;
          abortController.abort(error);
        },
      });

      const initialPhase = "extract";
      const initialStep = "load_input";
      const startedAt = new Date();
      const attemptTrigger = toExtractionAttemptTrigger(event.revision);
      await deps.db.transaction(async (tx) => {
        const lockedFiles = await tx
          .select({
            id: intakeFiles.id,
            purgeStatus: intakeFiles.purgeStatus,
            removedFromBatchAt: intakeFiles.removedFromBatchAt,
          })
          .from(intakeFiles)
          .where(eq(intakeFiles.id, event.uploadId))
          .for("update")
          .limit(1);
        const lockedFile = lockedFiles.at(0);
        const lockedBatches = await tx
          .select({ id: intakeBatches.id, deletedAt: intakeBatches.deletedAt })
          .from(intakeBatches)
          .where(eq(intakeBatches.id, event.batchId))
          .for("update")
          .limit(1);
        const lockedBatch = lockedBatches.at(0);
        if (
          !lockedFile ||
          !lockedBatch ||
          lockedFile.purgeStatus ||
          lockedFile.removedFromBatchAt ||
          lockedBatch.deletedAt
        ) {
          throw new Error(
            "The upload is unavailable because deletion has started.",
          );
        }

        if (claimResult.takeover) {
          await tx
            .update(workerJobs)
            .set({
              status: "failed",
              currentStep: "lease_expired",
              errorSummary: "Worker claim lease expired and was taken over.",
              finishedAt: startedAt,
              updatedAt: startedAt,
            })
            .where(
              and(
                eq(workerJobs.eventId, event.eventId),
                eq(workerJobs.status, "processing"),
                ne(workerJobs.jobId, claim.jobId),
              ),
            );

          await tx
            .update(documentExtractionAttempts)
            .set({
              status: "failed",
              reasonCodes: ["claim_lease_expired"],
              finishedAt: startedAt,
              updatedAt: startedAt,
            })
            .where(
              and(
                eq(documentExtractionAttempts.eventId, event.eventId),
                eq(documentExtractionAttempts.status, "processing"),
                ne(documentExtractionAttempts.jobId, claim.jobId),
              ),
            );
        }

        await tx.insert(workerJobs).values({
          jobId: claim.jobId,
          eventId: event.eventId,
          batchId: event.batchId,
          uploadId: event.uploadId,
          source: event.source,
          originalFileName: event.originalFileName,
          mimeType: event.mimeType,
          sizeBytes: event.sizeBytes,
          status: "processing",
          currentPhase: initialPhase,
          currentStep: initialStep,
          attempts: claim.attemptNumber,
          startedAt,
        });

        const insertedAttempts = await tx
          .insert(documentExtractionAttempts)
          .values({
            uploadId: event.uploadId,
            jobId: claim.jobId,
            eventId: event.eventId,
            revision: event.revision,
            workerAttemptNumber: claim.attemptNumber,
            trigger: attemptTrigger.trigger,
            retryNumber: attemptTrigger.retryNumber,
            status: "processing",
            reasonCodes: [],
            requestedModel: geminiConfig.model,
            thinkingLevel: geminiConfig.thinkingLevel,
            mediaResolution: geminiConfig.mediaResolution,
            startedAt,
          })
          .returning({ id: documentExtractionAttempts.id });
        extractionAttemptId = insertedAttempts[0]?.id ?? null;
        if (!extractionAttemptId) {
          throw new Error("Unable to create document extraction attempt.");
        }

        await tx
          .update(intakeFiles)
          .set({
            ...buildCertificateMetadataFields(event.originalFileName),
            sourceFileId: event.sourceFileId,
            revision: event.revision,
            eventId: event.eventId,
            traceId: event.traceId,
            artifactUri: event.artifactUri,
            queueStatus: "queued",
            processingStatus: "processing",
            currentPhase: initialPhase,
            currentStep: initialStep,
            processingStartedAt: startedAt,
            errorMessage: null,
            updatedAt: startedAt,
          })
          .where(eq(intakeFiles.id, event.uploadId));

        await tx
          .update(intakeBatches)
          .set({
            lastActivityAt: startedAt,
            updatedAt: startedAt,
          })
          .where(eq(intakeBatches.id, event.batchId));
      });
      jobInitialized = true;
      const activeExtractionAttemptId = extractionAttemptId;
      if (!activeExtractionAttemptId) {
        throw new Error("Document extraction attempt was not initialized.");
      }

      if (heartbeat.hasLostOwnership() || ownershipLostError) {
        throw (
          ownershipLostError ??
          new ClaimOwnershipLostError(
            "Worker claim ownership was lost before workflow execution.",
          )
        );
      }

      const result = (await workflow.invoke(
        {
          event,
          jobId: claim.jobId,
          extractionAttemptId: activeExtractionAttemptId,
        },
        {
          callbacks: langfuseHandler ? [langfuseHandler] : [],
          runName: `worker-workflow:${claim.jobId}`,
          metadata: {
            jobId: claim.jobId,
            eventId: event.eventId,
            sourceFileId: event.sourceFileId,
            revision: event.revision,
          },
          signal: abortController.signal,
        },
      )) as WorkflowState;

      await heartbeat.stop();
      if (heartbeat.hasLostOwnership() || ownershipLostError) {
        throw (
          ownershipLostError ??
          new ClaimOwnershipLostError(
            "Worker claim ownership was lost before workflow completion.",
          )
        );
      }

      const renewedLeaseExpiresAt = await idempotencyRepository.renew(
        deps.db,
        claim,
        leaseDurationSeconds,
      );
      if (!renewedLeaseExpiresAt) {
        throw new ClaimOwnershipLostError(
          "Worker claim ownership was lost before terminal finalization.",
        );
      }

      const terminalStatus: WorkflowOutcome =
        result.decision?.terminalStatus ?? "Error";
      const terminalJobStatus = mapTerminalState(terminalStatus);
      const finishedAt = new Date();

      await deps.db.transaction(async (tx) => {
        const completed = await idempotencyRepository.complete(
          tx,
          claim,
          terminalJobStatus,
        );
        if (!completed) {
          throw new ClaimOwnershipLostError(
            "Worker claim ownership was lost during terminal finalization.",
          );
        }

        await tx
          .update(workerJobs)
          .set({
            status: terminalJobStatus,
            currentPhase: result.decision?.phase ?? "persist",
            currentStep: "complete",
            finishedAt,
            updatedAt: finishedAt,
          })
          .where(eq(workerJobs.jobId, claim.jobId));

        await tx
          .update(intakeFiles)
          .set({
            processingStatus: terminalJobStatus,
            currentPhase: result.decision?.phase ?? "persist",
            currentStep: "complete",
            processingFinishedAt: finishedAt,
            errorMessage: null,
            updatedAt: finishedAt,
          })
          .where(eq(intakeFiles.id, event.uploadId));

        await tx
          .update(intakeBatches)
          .set({
            lastActivityAt: finishedAt,
            updatedAt: finishedAt,
          })
          .where(eq(intakeBatches.id, event.batchId));
      });

      await recordWorkerStepBestEffort({
        db: deps.db,
        logger,
        values: {
          jobId: claim.jobId,
          stepName: "workflow",
          status: terminalJobStatus,
          metadata: {
            eventId: event.eventId,
            terminalOutcome: terminalStatus,
            reasonCodes: result.decision?.reasonCodes ?? [],
          },
        },
      });

      logger.info("Completed owned worker event claim", {
        eventId: event.eventId,
        idempotencyKey: idemKey,
        jobId: claim.jobId,
        attemptNumber: claim.attemptNumber,
        terminalState: terminalJobStatus,
      });
      return { kind: "acknowledge" };
    } catch (error) {
      await heartbeat?.stop();
      const processingError = ownershipLostError ?? error;
      await recordClaimFailure({
        db: deps.db,
        idempotencyRepository,
        claim,
        event,
        jobInitialized,
        error: processingError,
        logger,
      });
      throw processingError;
    }
  };
}

async function recordClaimFailure(input: {
  db: DbClient;
  idempotencyRepository: WorkerIdempotencyRepository;
  claim: WorkerEventClaim;
  event: DocumentIngestEventV1;
  jobInitialized: boolean;
  error: unknown;
  logger: Logger;
}): Promise<void> {
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);
  const ownershipLost = input.error instanceof ClaimOwnershipLostError;
  const finishedAt = new Date();

  try {
    await input.db.transaction(async (tx) => {
      const released = await input.idempotencyRepository.fail(tx, input.claim);

      if (!input.jobInitialized) {
        return;
      }

      await tx
        .update(workerJobs)
        .set({
          status: "failed",
          currentStep: ownershipLost ? "claim_lost" : "workflow_failed",
          errorSummary: errorMessage,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(workerJobs.jobId, input.claim.jobId));

      await tx
        .update(documentExtractionAttempts)
        .set({
          status: "failed",
          reasonCodes: [ownershipLost ? "claim_lost" : "workflow_failed"],
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(
          and(
            eq(documentExtractionAttempts.jobId, input.claim.jobId),
            eq(documentExtractionAttempts.status, "processing"),
          ),
        );

      if (released) {
        await tx
          .update(intakeFiles)
          .set({
            processingStatus: "error",
            currentStep: "workflow_failed",
            errorMessage,
            updatedAt: finishedAt,
          })
          .where(eq(intakeFiles.id, input.event.uploadId));

        await tx
          .update(intakeBatches)
          .set({
            lastActivityAt: finishedAt,
            updatedAt: finishedAt,
          })
          .where(eq(intakeBatches.id, input.event.batchId));
      }
    });

    if (input.jobInitialized) {
      await recordWorkerStepBestEffort({
        db: input.db,
        logger: input.logger,
        values: {
          jobId: input.claim.jobId,
          stepName: "workflow",
          status: "failed",
          metadata: {
            error: errorMessage,
            ownershipLost,
          },
        },
      });
    }
  } catch (recordingError) {
    input.logger.error("Failed to record worker claim failure", {
      eventId: input.event.eventId,
      jobId: input.claim.jobId,
      claimOwner: input.claim.claimOwner,
      attemptNumber: input.claim.attemptNumber,
      error:
        recordingError instanceof Error
          ? recordingError.message
          : String(recordingError),
    });
  }
}

async function recordWorkerStepBestEffort(input: {
  db: DbClient;
  logger: Logger;
  values: typeof workerJobSteps.$inferInsert;
}): Promise<void> {
  try {
    await input.db.insert(workerJobSteps).values(input.values);
  } catch (error) {
    input.logger.warn("worker_step_tracking_failed", {
      jobId: input.values.jobId,
      stepName: input.values.stepName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createLangfuseCallbackHandler(
  env: WorkerEnv,
  logger: Logger,
): CallbackHandler | null {
  const enabled = normalizeEnabled(
    env.LANGFUSE_ENABLED ?? env.TAXTRACK_LANGFUSE_ENABLED,
  );
  if (!enabled) {
    return null;
  }

  const publicKey = env.LANGFUSE_PUBLIC_KEY ?? env.TAXTRACK_LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY ?? env.TAXTRACK_LANGFUSE_SECRET_KEY;
  const host = env.LANGFUSE_HOST ?? env.TAXTRACK_LANGFUSE_HOST;

  if (!publicKey || !secretKey) {
    logger.warn(
      "Langfuse callback disabled because Langfuse public/secret keys are missing",
    );
    return null;
  }

  if (isSelfReferentialLangfuseHost(host, env.WORKER_PORT)) {
    logger.warn(
      "Langfuse callback disabled because host points to the worker itself",
      {
        host,
        workerPort: env.WORKER_PORT,
      },
    );
    return null;
  }

  return new CallbackHandler({
    publicKey,
    secretKey,
    ...(host ? { baseUrl: host } : {}),
    mask: ({ data }) => redactLangfuseData(data),
  });
}

const LANGFUSE_REDACTED_VALUE = "[REDACTED]";
const LANGFUSE_SENSITIVE_KEYS = new Set([
  "certificate",
  "certificates",
  "evidence",
  "extracted",
  "extraction",
  "extractionresult",
  "payload",
  "payee",
  "payor",
  "prompt",
  "rawresponse",
  "signer",
  "sourcecontentbase64",
  "taxrows",
  "thought",
  "thoughts",
]);

export function redactLangfuseData(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return LANGFUSE_REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLangfuseData(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
      const containsSensitiveField =
        LANGFUSE_SENSITIVE_KEYS.has(normalizedKey) ||
        /(?:address|tin)$/iu.test(normalizedKey) ||
        /(?:pdf|content)base64$/iu.test(normalizedKey);

      return [
        key,
        containsSensitiveField
          ? LANGFUSE_REDACTED_VALUE
          : redactLangfuseData(item),
      ];
    }),
  );
}

function normalizeEnabled(value: boolean | string | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return (
      value.toLowerCase() !== "false" &&
      value !== "0" &&
      value.toLowerCase() !== "off"
    );
  }

  return true;
}

function isSelfReferentialLangfuseHost(
  host: string | undefined,
  workerPort: number,
): boolean {
  if (!host) {
    return false;
  }

  try {
    const parsed = new URL(host);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    const port =
      parsed.port.length > 0
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 80;

    return isLoopback && port === workerPort;
  } catch {
    return false;
  }
}
