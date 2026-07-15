import assert from "node:assert/strict";
import test from "node:test";

import { createPersistDuplicateNode } from "./persistDuplicate.ts";
import { createPersistValidationFailNode } from "./persistValidationFail.ts";
import type { WorkflowState } from "../types.ts";
import type { ResultPersistenceService } from "../../persistence/resultPersistence.ts";
import type { PreparedResultIntent } from "../../persistence/types.ts";

function createState(
  reasonCodes: string[] = ["invalid_tax_withheld"],
): WorkflowState {
  return {
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "test_file_2307.pdf",
    },
    jobId: "job-1",
    normalized: {
      periodEnd: "09-30-2025",
      monthOfQuarter: "second",
      payeeName: "Therma Mobile, Inc.",
      payeeTin: "266-566-116-000",
      payorName: "Customer A",
      payorTin: "123-456-789-000",
      taxBase: 100,
    },
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        normalized: {
          periodEnd: "09-30-2025",
          monthOfQuarter: "second",
        },
      },
    ],
    validation: {
      status: "invalid",
      reasons: reasonCodes,
      checks: [],
    },
    decision: {
      terminalStatus: "Error",
      route: "error",
      reasonCodes,
      phase: "validate",
      sourceFileId: "source-1",
      revision: "v1",
    },
  };
}

function createDb() {
  const shortNameRows = [[{ shortName: "TMI" }], [{ shortName: "ACME" }]];
  let shortNameSelectCount = 0;

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => shortNameRows[shortNameSelectCount++] ?? [],
          }),
        }),
      }),
    }),
  };

  return db;
}

function createPersistenceCapture() {
  let intent: PreparedResultIntent | undefined;
  const persistence: ResultPersistenceService = {
    hasExisting: async () => false,
    persistPreparedResult: async (input) => {
      intent = input.build({
        documentResultId: 123,
        processedNumber: 1,
        preparedAt: "2025-09-30T00:00:00.000Z",
      });
      return {
        operationId: "operation-1",
        documentResultId: 123,
        outcome: input.outcome,
        artifactKey: intent.documentResult.artifactKey ?? undefined,
        artifactKeys: {},
        decision: {
          terminalStatus: input.outcome,
          route: input.outcome === "Duplicate" ? "duplicate" : "error",
          reasonCodes: [],
          phase: "persist",
        },
      };
    },
    resumeExisting: async () => null,
    listEligible: async () => [],
    getBacklog: async () => ({ count: 0, oldestCreatedAt: null }),
    blockInvalidIntent: async () => undefined,
  };
  return {
    persistence,
    get intent() {
      return intent;
    },
  };
}

test("persistValidationFail freezes extracted certificate metadata for generic filenames", async () => {
  const capture = createPersistenceCapture();
  const node = createPersistValidationFailNode({
    db: createDb() as never,
    bucket: "bucket",
    persistence: capture.persistence,
  });

  await node(createState());

  assert.ok(capture.intent);
  assert.equal(
    capture.intent.certificateMetadata.certificateDocumentType,
    "BIR2307",
  );
  assert.equal(capture.intent.documentResult.outcome, "Error");
  assert.deepEqual(capture.intent.documentResult.reasonCodes, [
    "invalid_tax_withheld",
  ]);
});

test("persistDuplicate freezes certificate metadata without changing duplicate outcome", async () => {
  const capture = createPersistenceCapture();
  const node = createPersistDuplicateNode({
    db: createDb() as never,
    bucket: "bucket",
    persistence: capture.persistence,
  });

  await node(createState(["duplicate_source_file_revision"]));

  assert.ok(capture.intent);
  assert.equal(
    capture.intent.certificateMetadata.certificateBillingMonthMMYY,
    "0825",
  );
  assert.equal(capture.intent.documentResult.outcome, "Duplicate");
  assert.equal(capture.intent.documentResult.status, "duplicate");
});
