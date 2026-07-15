import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { DocumentIngestEventV1Schema, type Logger } from "@taxtrack/shared";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, gt, inArray, lte, ne, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { applyAutomaticReconciliationMatch } from "../db/reconciliationAutoMatch";
import {
  documentResults,
  resultPersistenceArtifacts,
  resultPersistenceOperations,
  workerIdempotency,
} from "../db/schema";
import { persistIntakeFileCertificateMetadata } from "../langgraph/utils/certificateMetadata";
import { splitPdfPages } from "../langgraph/utils/pageProcessing";
import type { ArtifactKeys, WorkflowOutcome } from "../langgraph/types";
import { reserveCertificateProcessedNumber } from "./processedNumber";
import type {
  PersistenceArtifactRole,
  PersistenceReservation,
  PersistenceResumeResult,
  PrepareResultPersistenceInput,
  PreparedArtifact,
  PreparedDocumentResult,
  PreparedResultIntent,
} from "./types";

type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type PersistenceOperation = typeof resultPersistenceOperations.$inferSelect;
type PersistenceArtifact = typeof resultPersistenceArtifacts.$inferSelect;

const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 15 * 60_000;
const CHECKSUM_METADATA_KEY = "taxtrack-sha256";

export class PersistenceBlockedError extends Error {
  constructor(
    message: string,
    readonly artifactId?: string,
  ) {
    super(message);
    this.name = "PersistenceBlockedError";
  }
}

export class PersistenceOwnershipLostError extends Error {
  constructor(
    message = "The worker no longer owns this persistence operation.",
  ) {
    super(message);
    this.name = "PersistenceOwnershipLostError";
  }
}

interface ResultPersistenceDeps {
  db: DbClient;
  s3: S3Client;
  logger: Logger;
  now?: () => Date;
  random?: () => number;
  afterArtifactWrite?: (artifact: {
    id: string;
    operationId: string;
    role: string;
    bucket: string;
    key: string;
  }) => Promise<void> | void;
}

interface PreparedOperation {
  operation: PersistenceOperation;
  inlineBodies: Map<PersistenceArtifactRole, Buffer>;
}

export interface ResultPersistenceService {
  hasExisting(eventId: string): Promise<boolean>;
  persistPreparedResult(
    input: PrepareResultPersistenceInput,
    jobId: string,
  ): Promise<PersistenceResumeResult>;
  resumeExisting(
    eventId: string,
    jobId: string,
  ): Promise<PersistenceResumeResult | null>;
  listEligible(limit: number): Promise<PersistenceOperation[]>;
  getBacklog(): Promise<{ count: number; oldestCreatedAt: Date | null }>;
  blockInvalidIntent(operationId: string, reason: string): Promise<void>;
}

function checksum(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    record.name === "NotFound" ||
    record.name === "NoSuchKey" ||
    record.$metadata?.httpStatusCode === 404
  );
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    record.name === "PreconditionFailed" ||
    record.$metadata?.httpStatusCode === 412
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asOutcome(value: string): WorkflowOutcome {
  if (value === "Done" || value === "Error" || value === "Duplicate") {
    return value;
  }
  throw new PersistenceBlockedError(
    `Unsupported persistence outcome: ${value}`,
  );
}

function toArtifactKeys(documentResult: Record<string, unknown>): ArtifactKeys {
  const payload = toRecord(documentResult.payload);
  const artifactKeys = toRecord(payload.artifactKeys);
  return {
    source:
      typeof artifactKeys.source === "string" ? artifactKeys.source : undefined,
    rawResultJson:
      typeof artifactKeys.rawResultJson === "string"
        ? artifactKeys.rawResultJson
        : undefined,
    finalResultJson:
      typeof artifactKeys.finalResultJson === "string"
        ? artifactKeys.finalResultJson
        : undefined,
    renamedPdf:
      typeof artifactKeys.renamedPdf === "string"
        ? artifactKeys.renamedPdf
        : undefined,
  };
}

function toResumeResult(
  operation: PersistenceOperation,
): PersistenceResumeResult {
  const outcome = asOutcome(operation.outcome);
  const documentResult = toRecord(operation.documentResult);
  const reasonCodes = Array.isArray(documentResult.reasonCodes)
    ? documentResult.reasonCodes.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const artifactKey =
    typeof documentResult.artifactKey === "string"
      ? documentResult.artifactKey
      : undefined;

  return {
    operationId: operation.id,
    documentResultId: operation.reservedDocumentResultId,
    outcome,
    artifactKey,
    artifactKeys: toArtifactKeys(documentResult),
    decision: {
      terminalStatus: outcome,
      route:
        outcome === "Error"
          ? "error"
          : outcome === "Duplicate"
            ? "duplicate"
            : "continue",
      reasonCodes,
      phase: "persist",
      sourceFileId:
        typeof documentResult.sourceFileId === "string"
          ? documentResult.sourceFileId
          : undefined,
      revision:
        typeof documentResult.revision === "string"
          ? documentResult.revision
          : undefined,
      finishedAt: operation.completedAt?.toISOString(),
    },
  };
}

function validateDurableIntent(
  operation: PersistenceOperation,
  artifacts: PersistenceArtifact[],
): void {
  const parsedEvent = DocumentIngestEventV1Schema.safeParse(operation.event);
  if (!parsedEvent.success) {
    throw new PersistenceBlockedError(
      `Stored event is invalid: ${parsedEvent.error.message}`,
    );
  }
  if (
    parsedEvent.data.eventId !== operation.eventId ||
    parsedEvent.data.uploadId !== operation.uploadId ||
    parsedEvent.data.batchId !== operation.batchId
  ) {
    throw new PersistenceBlockedError(
      "Stored event identifiers do not match the persistence operation.",
    );
  }

  const documentResult = toRecord(operation.documentResult);
  for (const [field, expected] of [
    ["eventId", operation.eventId],
    ["uploadId", operation.uploadId],
    ["batchId", operation.batchId],
    ["outcome", operation.outcome],
  ] as const) {
    if (documentResult[field] !== expected) {
      throw new PersistenceBlockedError(
        `Prepared document result ${field} does not match the operation.`,
      );
    }
  }
  for (const field of ["sourceFileId", "revision", "status"] as const) {
    if (
      typeof documentResult[field] !== "string" ||
      documentResult[field].length === 0
    ) {
      throw new PersistenceBlockedError(
        `Prepared document result ${field} is invalid.`,
      );
    }
  }
  if (
    !Array.isArray(documentResult.reasonCodes) ||
    !documentResult.reasonCodes.every((value) => typeof value === "string")
  ) {
    throw new PersistenceBlockedError(
      "Prepared document result reasonCodes are invalid.",
    );
  }
  if (
    Object.keys(toRecord(documentResult.payload)).length === 0 ||
    Object.keys(toRecord(documentResult.validation)).length === 0
  ) {
    throw new PersistenceBlockedError(
      "Prepared document result payload or validation is invalid.",
    );
  }

  const artifactKeys = toRecord(toRecord(documentResult.payload).artifactKeys);
  const artifactByRole = new Map(
    artifacts.map((artifact) => [artifact.role, artifact]),
  );
  const expectedRoles =
    operation.outcome === "Done"
      ? (["raw_json", "final_json", "unsigned_pdf"] as const)
      : (["final_json"] as const);
  if (
    artifacts.length !== expectedRoles.length ||
    expectedRoles.some((role) => !artifactByRole.has(role))
  ) {
    throw new PersistenceBlockedError(
      `Persistence outcome ${operation.outcome} has an invalid artifact manifest.`,
    );
  }
  for (const [role, pointerName] of [
    ["raw_json", "rawResultJson"],
    ["final_json", "finalResultJson"],
    ["unsigned_pdf", "renamedPdf"],
  ] as const) {
    const artifact = artifactByRole.get(role);
    const pointer = artifactKeys[pointerName];
    if (artifact && pointer !== artifact.key) {
      throw new PersistenceBlockedError(
        `Artifact ${role} does not match payload.artifactKeys.${pointerName}.`,
        artifact.id,
      );
    }
    if (!artifact && pointer !== undefined) {
      throw new PersistenceBlockedError(
        `payload.artifactKeys.${pointerName} references an unprepared object.`,
      );
    }
  }
  if (documentResult.artifactKey !== artifactKeys.finalResultJson) {
    throw new PersistenceBlockedError(
      "artifactKey must point to the terminal JSON artifact.",
    );
  }
  if (operation.outcome === "Done") {
    if (
      typeof documentResult.finalKey !== "string" ||
      documentResult.finalKey !== artifactKeys.renamedPdf
    ) {
      throw new PersistenceBlockedError(
        "A successful result finalKey must point to its unsigned PDF.",
      );
    }
  } else if (documentResult.finalKey !== null) {
    throw new PersistenceBlockedError(
      `${operation.outcome} results must not have a finalKey.`,
    );
  }
}

function artifactRow(
  operationId: string,
  artifact: PreparedArtifact,
): typeof resultPersistenceArtifacts.$inferInsert {
  if (artifact.body.kind === "text") {
    return {
      operationId,
      role: artifact.role,
      bucket: artifact.bucket,
      key: artifact.key,
      contentType: artifact.contentType,
      bodyKind: "text",
      bodyText: artifact.body.text,
      sourceDescriptor: null,
      sha256: checksum(artifact.body.text),
    };
  }

  return {
    operationId,
    role: artifact.role,
    bucket: artifact.bucket,
    key: artifact.key,
    contentType: artifact.contentType,
    bodyKind: "source_page",
    bodyText: null,
    sourceDescriptor: {
      bucket: artifact.body.sourceBucket,
      key: artifact.body.sourceKey,
      pageNumber: artifact.body.sourcePageNumber,
      sourceSha256: artifact.body.sourceSha256,
    },
    sha256: checksum(artifact.body.inlineBody),
  };
}

async function reserveDocumentResultId(tx: DbTransaction): Promise<number> {
  const result = await tx.execute<{ id: number }>(
    sql`select nextval(pg_get_serial_sequence('document_results', 'id'))::int as id`,
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Unable to reserve a document result id.");
  }
  return id;
}

async function prepareOperation(
  deps: ResultPersistenceDeps,
  input: PrepareResultPersistenceInput,
): Promise<PreparedOperation> {
  return deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`result-persistence:${input.event.eventId}`}))`,
    );

    const existing = await tx
      .select()
      .from(resultPersistenceOperations)
      .where(eq(resultPersistenceOperations.eventId, input.event.eventId))
      .limit(1);
    if (existing[0]) {
      if (existing[0].uploadId !== input.event.uploadId) {
        throw new PersistenceBlockedError(
          "A persistence event is already bound to a different upload.",
        );
      }
      return { operation: existing[0], inlineBodies: new Map() };
    }

    const documentResultId = await reserveDocumentResultId(tx);
    const processedNumber =
      input.outcome === "Done"
        ? await reserveCertificateProcessedNumber(tx, {
            payorShortName: input.payorShortName,
            uploadedAt: input.uploadedAt,
          })
        : 1;
    const preparedAt = (deps.now ?? (() => new Date()))().toISOString();
    const reservation: PersistenceReservation = {
      documentResultId,
      processedNumber,
      preparedAt,
    };
    const intent = input.build(reservation);
    const inserted = await tx
      .insert(resultPersistenceOperations)
      .values({
        eventId: input.event.eventId,
        uploadId: input.event.uploadId,
        batchId: input.event.batchId,
        reservedDocumentResultId: documentResultId,
        outcome: input.outcome,
        state: "pending_artifacts",
        event: input.event,
        documentResult: intent.documentResult as Record<string, unknown>,
        certificateMetadata: intent.certificateMetadata,
        reconciliationInput: intent.reconciliationInput,
        processedNumber: input.outcome === "Done" ? processedNumber : undefined,
      })
      .returning();
    const operation = inserted[0];
    if (!operation) {
      throw new Error("Unable to create result persistence operation.");
    }

    if (intent.artifacts.length === 0) {
      throw new PersistenceBlockedError(
        "A result persistence operation requires at least one artifact.",
      );
    }

    await tx
      .insert(resultPersistenceArtifacts)
      .values(
        intent.artifacts.map((artifact) => artifactRow(operation.id, artifact)),
      );

    const inlineBodies = new Map<PersistenceArtifactRole, Buffer>();
    for (const artifact of intent.artifacts) {
      if (artifact.body.kind === "source_page") {
        inlineBodies.set(artifact.role, artifact.body.inlineBody);
      }
    }

    deps.logger.info("persistence_operation_prepared", {
      operationId: operation.id,
      eventId: operation.eventId,
      uploadId: operation.uploadId,
      outcome: operation.outcome,
      artifactCount: intent.artifacts.length,
    });
    return { operation, inlineBodies };
  });
}

async function loadArtifactBody(
  deps: ResultPersistenceDeps,
  artifact: PersistenceArtifact,
  inlineBodies: Map<PersistenceArtifactRole, Buffer>,
): Promise<Buffer> {
  if (artifact.bodyKind === "text") {
    if (artifact.bodyText === null) {
      throw new PersistenceBlockedError(
        `Text artifact ${artifact.id} has no durable body.`,
        artifact.id,
      );
    }
    return Buffer.from(artifact.bodyText);
  }

  if (artifact.bodyKind !== "source_page") {
    throw new PersistenceBlockedError(
      `Artifact ${artifact.id} has unsupported body kind ${artifact.bodyKind}.`,
      artifact.id,
    );
  }

  const inlineBody = inlineBodies.get(artifact.role as PersistenceArtifactRole);
  if (inlineBody) {
    return inlineBody;
  }

  const descriptor = toRecord(artifact.sourceDescriptor);
  const bucket =
    typeof descriptor.bucket === "string" ? descriptor.bucket : null;
  const key = typeof descriptor.key === "string" ? descriptor.key : null;
  const pageNumber = Number(descriptor.pageNumber);
  if (!bucket || !key || !Number.isInteger(pageNumber) || pageNumber <= 0) {
    throw new PersistenceBlockedError(
      `Artifact ${artifact.id} has an invalid source-page descriptor.`,
      artifact.id,
    );
  }

  const response = await deps.s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) {
    throw new Error(`Source object ${bucket}/${key} returned no body.`);
  }
  const source = Buffer.from(await response.Body.transformToByteArray());
  const expectedSourceSha256 =
    typeof descriptor.sourceSha256 === "string"
      ? descriptor.sourceSha256
      : undefined;
  if (expectedSourceSha256 && checksum(source) !== expectedSourceSha256) {
    throw new PersistenceBlockedError(
      `Source object checksum changed for artifact ${artifact.id}.`,
      artifact.id,
    );
  }

  const pages = await splitPdfPages(source);
  const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
  if (!page) {
    throw new PersistenceBlockedError(
      `Source page ${pageNumber} is unavailable for artifact ${artifact.id}.`,
      artifact.id,
    );
  }
  return page.content;
}

async function getExistingChecksum(
  deps: ResultPersistenceDeps,
  artifact: PersistenceArtifact,
): Promise<string | null> {
  try {
    const head = await deps.s3.send(
      new HeadObjectCommand({ Bucket: artifact.bucket, Key: artifact.key }),
    );
    const metadataChecksum = head.Metadata?.[CHECKSUM_METADATA_KEY];
    if (metadataChecksum) {
      return metadataChecksum;
    }

    const existing = await deps.s3.send(
      new GetObjectCommand({ Bucket: artifact.bucket, Key: artifact.key }),
    );
    if (!existing.Body) {
      throw new Error(
        `Existing object ${artifact.bucket}/${artifact.key} returned no body.`,
      );
    }
    return checksum(Buffer.from(await existing.Body.transformToByteArray()));
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function ensureArtifact(
  deps: ResultPersistenceDeps,
  artifact: PersistenceArtifact,
  inlineBodies: Map<PersistenceArtifactRole, Buffer>,
): Promise<void> {
  if (artifact.state === "verified") {
    return;
  }
  if (artifact.state === "blocked") {
    throw new PersistenceBlockedError(
      artifact.lastError ?? `Artifact ${artifact.id} is blocked.`,
      artifact.id,
    );
  }

  const existingChecksum = await getExistingChecksum(deps, artifact);
  if (existingChecksum !== null) {
    if (existingChecksum !== artifact.sha256) {
      throw new PersistenceBlockedError(
        `Artifact destination ${artifact.bucket}/${artifact.key} contains different content.`,
        artifact.id,
      );
    }
  } else {
    const body = await loadArtifactBody(deps, artifact, inlineBodies);
    const actualChecksum = checksum(body);
    if (actualChecksum !== artifact.sha256) {
      throw new PersistenceBlockedError(
        `Prepared artifact checksum changed for ${artifact.id}.`,
        artifact.id,
      );
    }

    try {
      await deps.s3.send(
        new PutObjectCommand({
          Bucket: artifact.bucket,
          Key: artifact.key,
          Body: body,
          ContentType: artifact.contentType,
          IfNoneMatch: "*",
          Metadata: { [CHECKSUM_METADATA_KEY]: artifact.sha256 },
        }),
      );
    } catch (error) {
      if (!isPreconditionFailed(error)) {
        throw error;
      }
      const racedChecksum = await getExistingChecksum(deps, artifact);
      if (racedChecksum !== artifact.sha256) {
        throw new PersistenceBlockedError(
          `Concurrent artifact write produced different content for ${artifact.bucket}/${artifact.key}.`,
          artifact.id,
        );
      }
    }
  }

  await deps.afterArtifactWrite?.({
    id: artifact.id,
    operationId: artifact.operationId,
    role: artifact.role,
    bucket: artifact.bucket,
    key: artifact.key,
  });
  const verifiedAt = (deps.now ?? (() => new Date()))();
  await deps.db
    .update(resultPersistenceArtifacts)
    .set({
      state: "verified",
      verifiedAt,
      attemptCount: sql`${resultPersistenceArtifacts.attemptCount} + 1`,
      lastError: null,
      updatedAt: verifiedAt,
    })
    .where(eq(resultPersistenceArtifacts.id, artifact.id));
  deps.logger.info("persistence_artifact_verified", {
    operationId: artifact.operationId,
    artifactId: artifact.id,
    role: artifact.role,
    bucket: artifact.bucket,
    key: artifact.key,
  });
}

async function assertClaimOwnership(
  tx: DbTransaction,
  eventId: string,
  jobId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: workerIdempotency.id })
    .from(workerIdempotency)
    .where(
      and(
        eq(workerIdempotency.idempotencyKey, eventId),
        eq(workerIdempotency.jobId, jobId),
        eq(workerIdempotency.terminalState, "running"),
        gt(workerIdempotency.leaseExpiresAt, sql`clock_timestamp()`),
      ),
    )
    .limit(1);
  if (rows.length !== 1) {
    throw new PersistenceOwnershipLostError();
  }
}

function documentResultInsertValues(
  operation: PersistenceOperation,
  jobId: string,
): typeof documentResults.$inferInsert {
  const prepared = operation.documentResult as PreparedDocumentResult;
  return {
    ...prepared,
    id: operation.reservedDocumentResultId,
    jobId,
  } as typeof documentResults.$inferInsert;
}

function existingResultMatchesIntent(
  existing: typeof documentResults.$inferSelect,
  operation: PersistenceOperation,
): boolean {
  if (existing.id !== operation.reservedDocumentResultId) {
    return false;
  }
  const prepared = toRecord(operation.documentResult);
  const fields = [
    "eventId",
    "batchId",
    "uploadId",
    "sourceFileId",
    "revision",
    "outcome",
    "status",
    "finalKey",
    "originalFileName",
    "sourceHash",
    "dataFingerprint",
    "periodEnd",
    "payeeName",
    "payeeTin",
    "payeeShortName",
    "payorName",
    "payorTin",
    "payorShortName",
    "reasonCodes",
    "payload",
    "validation",
    "artifactKey",
  ] as const;
  return fields.every((field) =>
    isDeepStrictEqual(existing[field] ?? null, prepared[field] ?? null),
  );
}

async function finalizeOperation(
  deps: ResultPersistenceDeps,
  operationId: string,
  jobId: string,
): Promise<PersistenceOperation> {
  return deps.db.transaction(async (tx) => {
    const operations = await tx
      .select()
      .from(resultPersistenceOperations)
      .where(eq(resultPersistenceOperations.id, operationId))
      .limit(1)
      .for("update");
    const operation = operations[0];
    if (!operation) {
      throw new PersistenceBlockedError(
        `Persistence operation ${operationId} no longer exists.`,
      );
    }
    if (operation.state === "completed") {
      return operation;
    }
    if (operation.state === "blocked") {
      throw new PersistenceBlockedError(
        operation.lastError ??
          `Persistence operation ${operationId} is blocked.`,
      );
    }

    await assertClaimOwnership(tx, operation.eventId, jobId);
    const artifacts = await tx
      .select()
      .from(resultPersistenceArtifacts)
      .where(eq(resultPersistenceArtifacts.operationId, operation.id));
    if (
      artifacts.length === 0 ||
      artifacts.some((artifact) => artifact.state !== "verified")
    ) {
      throw new Error(
        `Persistence operation ${operation.id} is not ready to finalize.`,
      );
    }

    const existing = await tx
      .select()
      .from(documentResults)
      .where(eq(documentResults.uploadId, operation.uploadId))
      .limit(1);
    if (existing[0]) {
      if (!existingResultMatchesIntent(existing[0], operation)) {
        throw new PersistenceBlockedError(
          `Upload ${operation.uploadId} already has a conflicting document result.`,
        );
      }
    } else {
      await tx
        .insert(documentResults)
        .overridingSystemValue()
        .values(documentResultInsertValues(operation, jobId));
    }

    await persistIntakeFileCertificateMetadata(
      tx,
      operation.uploadId,
      operation.certificateMetadata as never,
    );

    const completedAt = (deps.now ?? (() => new Date()))();
    const completed = await tx
      .update(resultPersistenceOperations)
      .set({
        state: "completed",
        completedAt,
        lastError: null,
        updatedAt: completedAt,
      })
      .where(eq(resultPersistenceOperations.id, operation.id))
      .returning();
    if (!completed[0]) {
      throw new Error(
        `Unable to complete persistence operation ${operation.id}.`,
      );
    }
    return completed[0];
  });
}

async function markArtifactsReady(
  deps: ResultPersistenceDeps,
  operationId: string,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  await deps.db
    .update(resultPersistenceOperations)
    .set({
      state: "ready_to_finalize",
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(resultPersistenceOperations.id, operationId),
        inArray(resultPersistenceOperations.state, [
          "pending_artifacts",
          "ready_to_finalize",
          "retryable_error",
        ]),
      ),
    );
}

async function blockOperation(
  deps: ResultPersistenceDeps,
  operationId: string,
  error: PersistenceBlockedError,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  await deps.db.transaction(async (tx) => {
    if (error.artifactId) {
      await tx
        .update(resultPersistenceArtifacts)
        .set({
          state: "blocked",
          lastError: error.message,
          attemptCount: sql`${resultPersistenceArtifacts.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(eq(resultPersistenceArtifacts.id, error.artifactId));
    }
    await tx
      .update(resultPersistenceOperations)
      .set({
        state: "blocked",
        lastError: error.message,
        updatedAt: now,
      })
      .where(
        and(
          eq(resultPersistenceOperations.id, operationId),
          ne(resultPersistenceOperations.state, "completed"),
        ),
      );
  });
  deps.logger.error("persistence_operation_blocked", {
    operationId,
    artifactId: error.artifactId,
    error: error.message,
  });
}

async function scheduleRetry(
  deps: ResultPersistenceDeps,
  operation: PersistenceOperation,
  error: unknown,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const attempt = operation.attemptCount + 1;
  const exponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 10),
  );
  const random = deps.random ?? Math.random;
  const jittered = Math.min(
    RETRY_MAX_DELAY_MS,
    Math.round(exponential * (0.75 + random() * 0.5)),
  );
  const nextAttemptAt = new Date(now.getTime() + jittered);
  await deps.db
    .update(resultPersistenceOperations)
    .set({
      state: "retryable_error",
      attemptCount: attempt,
      nextAttemptAt,
      lastError: errorMessage(error),
      updatedAt: now,
    })
    .where(
      and(
        eq(resultPersistenceOperations.id, operation.id),
        ne(resultPersistenceOperations.state, "completed"),
        ne(resultPersistenceOperations.state, "blocked"),
      ),
    );
  deps.logger.warn("persistence_retry_scheduled", {
    operationId: operation.id,
    eventId: operation.eventId,
    attempt,
    nextAttemptAt: nextAttemptAt.toISOString(),
    error: errorMessage(error),
  });
}

async function applyReconciliationBestEffort(
  deps: ResultPersistenceDeps,
  operation: PersistenceOperation,
): Promise<void> {
  if (operation.outcome !== "Done" || !operation.reconciliationInput) {
    return;
  }
  const input = toRecord(operation.reconciliationInput);
  try {
    await applyAutomaticReconciliationMatch(deps.db, {
      batchId: String(input.batchId),
      documentResultId: operation.reservedDocumentResultId,
      uploadId: String(input.uploadId),
      sourceFileId: String(input.sourceFileId),
      originalFileName: String(input.originalFileName),
      normalized: toRecord(input.normalized),
      metadata: (input.metadata ?? null) as never,
    });
  } catch (error) {
    deps.logger.warn("Unable to apply reconciliation auto-match", {
      operationId: operation.id,
      documentResultId: operation.reservedDocumentResultId,
      error: errorMessage(error),
    });
  }
}

async function processOperation(
  deps: ResultPersistenceDeps,
  operation: PersistenceOperation,
  jobId: string,
  inlineBodies: Map<PersistenceArtifactRole, Buffer> = new Map(),
): Promise<PersistenceResumeResult> {
  if (operation.state === "completed") {
    return toResumeResult(operation);
  }
  if (operation.state === "blocked") {
    throw new PersistenceBlockedError(
      operation.lastError ??
        `Persistence operation ${operation.id} is blocked.`,
    );
  }

  deps.logger.info("persistence_operation_resumed", {
    operationId: operation.id,
    eventId: operation.eventId,
    state: operation.state,
    jobId,
  });

  try {
    const artifacts = await deps.db
      .select()
      .from(resultPersistenceArtifacts)
      .where(eq(resultPersistenceArtifacts.operationId, operation.id))
      .orderBy(asc(resultPersistenceArtifacts.createdAt));
    validateDurableIntent(operation, artifacts);
    for (const artifact of artifacts) {
      await ensureArtifact(deps, artifact, inlineBodies);
    }
    await markArtifactsReady(deps, operation.id);
    const completed = await finalizeOperation(deps, operation.id, jobId);
    await applyReconciliationBestEffort(deps, completed);
    deps.logger.info("persistence_operation_completed", {
      operationId: completed.id,
      eventId: completed.eventId,
      uploadId: completed.uploadId,
      outcome: completed.outcome,
      documentResultId: completed.reservedDocumentResultId,
    });
    return toResumeResult(completed);
  } catch (error) {
    if (error instanceof PersistenceBlockedError) {
      await blockOperation(deps, operation.id, error);
    } else if (!(error instanceof PersistenceOwnershipLostError)) {
      await scheduleRetry(deps, operation, error);
    }
    throw error;
  }
}

export function createResultPersistenceService(
  deps: ResultPersistenceDeps,
): ResultPersistenceService {
  return {
    hasExisting: async (eventId) => {
      const rows = await deps.db
        .select({ id: resultPersistenceOperations.id })
        .from(resultPersistenceOperations)
        .where(eq(resultPersistenceOperations.eventId, eventId))
        .limit(1);
      return rows.length === 1;
    },
    persistPreparedResult: async (input, jobId) => {
      const prepared = await prepareOperation(deps, input);
      return processOperation(
        deps,
        prepared.operation,
        jobId,
        prepared.inlineBodies,
      );
    },
    resumeExisting: async (eventId, jobId) => {
      const rows = await deps.db
        .select()
        .from(resultPersistenceOperations)
        .where(eq(resultPersistenceOperations.eventId, eventId))
        .limit(1);
      const operation = rows[0];
      return operation ? processOperation(deps, operation, jobId) : null;
    },
    listEligible: async (limit) => {
      const now = (deps.now ?? (() => new Date()))();
      return deps.db
        .select()
        .from(resultPersistenceOperations)
        .where(
          and(
            inArray(resultPersistenceOperations.state, [
              "pending_artifacts",
              "ready_to_finalize",
              "retryable_error",
            ]),
            lte(resultPersistenceOperations.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(resultPersistenceOperations.createdAt))
        .limit(limit);
    },
    getBacklog: async () => {
      const rows = await deps.db
        .select({
          count: sql<number>`count(*)::int`,
          oldestCreatedAt: sql<Date | null>`min(${resultPersistenceOperations.createdAt})`,
        })
        .from(resultPersistenceOperations)
        .where(ne(resultPersistenceOperations.state, "completed"));
      return {
        count: Number(rows[0]?.count ?? 0),
        oldestCreatedAt: rows[0]?.oldestCreatedAt ?? null,
      };
    },
    blockInvalidIntent: async (operationId, reason) => {
      await blockOperation(
        deps,
        operationId,
        new PersistenceBlockedError(`Invalid durable intent: ${reason}`),
      );
    },
  };
}

export function parsePersistenceEvent(operation: PersistenceOperation) {
  return DocumentIngestEventV1Schema.parse(operation.event);
}
