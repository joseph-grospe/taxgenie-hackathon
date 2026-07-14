import type { DocumentIngestEventV1, Logger } from "@taxtrack/shared";
import assert from "node:assert/strict";
import test from "node:test";

import type { ResultPersistenceService } from "./resultPersistence.ts";
import { PersistenceReconciler } from "./persistenceReconciler.ts";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const event: DocumentIngestEventV1 = {
  version: "v1",
  eventId: "event-1",
  traceId: "trace-1",
  source: "manual-upload",
  batchId: "11111111-1111-4111-8111-111111111111",
  uploadId: "22222222-2222-4222-8222-222222222222",
  sourceFileId: "source-1",
  revision: "v1",
  originalFileName: "certificate.pdf",
  modifiedTime: "2026-07-13T00:00:00.000Z",
  mimeType: "application/pdf",
  sizeBytes: 100,
  artifactUri: "s3://source-bucket/source.pdf",
  uploadedByUserId: "user-1",
  uploadedAt: "2026-07-13T00:00:00.000Z",
  receivedAt: "2026-07-13T00:00:00.000Z",
};

function operation(id: string, storedEvent: unknown = event) {
  return {
    id,
    eventId: id,
    uploadId: event.uploadId,
    batchId: event.batchId,
    reservedDocumentResultId: 1,
    outcome: "Done",
    state: "pending_artifacts",
    event: storedEvent,
    documentResult: {},
    certificateMetadata: {},
    reconciliationInput: null,
    processedNumber: 1,
    attemptCount: 0,
    nextAttemptAt: new Date(),
    lastError: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function serviceWithOperations(
  operations: Array<ReturnType<typeof operation>>,
  blockInvalidIntent: ResultPersistenceService["blockInvalidIntent"] = async () =>
    undefined,
): ResultPersistenceService {
  return {
    hasExisting: async () => operations.length > 0,
    persistPreparedResult: async () => {
      throw new Error("unused");
    },
    resumeExisting: async () => null,
    listEligible: async (limit) => operations.slice(0, limit) as never,
    getBacklog: async () => ({
      count: operations.length,
      oldestCreatedAt: operations[0]?.createdAt ?? null,
    }),
    blockInvalidIntent,
  };
}

test("reconciler scans at most five operations sequentially", async () => {
  const operations = Array.from({ length: 7 }, (_, index) =>
    operation(`event-${index + 1}`, {
      ...event,
      eventId: `event-${index + 1}`,
    }),
  );
  const processed: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const reconciler = new PersistenceReconciler({
    persistence: serviceWithOperations(operations),
    processMessage: async (body) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      processed.push(JSON.parse(body).event.eventId as string);
      active -= 1;
      return { kind: "acknowledge" };
    },
    logger,
    enabled: true,
    intervalMs: 30_000,
  });

  await reconciler.runOnce();

  assert.equal(processed.length, 5);
  assert.equal(maximumActive, 1);
});

test("reconciler blocks invalid durable event data", async () => {
  const blocked: Array<{ operationId: string; reason: string }> = [];
  const reconciler = new PersistenceReconciler({
    persistence: serviceWithOperations(
      [operation("invalid-operation", { eventId: "" })],
      async (operationId, reason) => {
        blocked.push({ operationId, reason });
      },
    ),
    processMessage: async () => assert.fail("invalid intent must not run"),
    logger,
    enabled: true,
    intervalMs: 30_000,
  });

  await reconciler.runOnce();

  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]?.operationId, "invalid-operation");
});

test("stop waits for an in-flight repair", async () => {
  let signalStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let releaseRepair: (() => void) | undefined;
  const repairReleased = new Promise<void>((resolve) => {
    releaseRepair = resolve;
  });
  const reconciler = new PersistenceReconciler({
    persistence: serviceWithOperations([operation("event-1")]),
    processMessage: async () => {
      signalStarted?.();
      await repairReleased;
      return { kind: "acknowledge" };
    },
    logger,
    enabled: true,
    intervalMs: 30_000,
  });

  reconciler.start();
  await started;
  let stopped = false;
  const stopping = reconciler.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  releaseRepair?.();
  await stopping;
  assert.equal(stopped, true);
});
