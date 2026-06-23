import assert from "node:assert/strict";
import test from "node:test";

import { createPersistDuplicateNode } from "./persistDuplicate.ts";
import { createPersistValidationFailNode } from "./persistValidationFail.ts";
import type { WorkflowState } from "../types.ts";

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
  const operations: string[] = [];
  const metadataUpdates: Array<Record<string, unknown>> = [];
  const insertedResults: Array<Record<string, unknown>> = [];
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
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          operations.push("metadata-update");
          metadataUpdates.push(values);
          return {};
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        operations.push("insert-result");
        insertedResults.push(values);
        return {};
      },
    }),
  };

  return { db, operations, metadataUpdates, insertedResults };
}

const s3 = {
  send: async () => undefined,
};

test("persistValidationFail updates extracted certificate metadata for generic filenames", async () => {
  const store = createDb();
  const node = createPersistValidationFailNode({
    db: store.db as never,
    s3: s3 as never,
    bucket: "bucket",
  });

  await node(createState());

  assert.deepEqual(store.operations, ["metadata-update", "insert-result"]);
  assert.equal(store.metadataUpdates.length, 1);
  assert.equal(
    "certificateDocumentType" in (store.metadataUpdates[0] ?? {}),
    true,
  );
  assert.equal(store.insertedResults[0]?.outcome, "Error");
  assert.deepEqual(store.insertedResults[0]?.reasonCodes, [
    "invalid_tax_withheld",
  ]);
});

test("persistDuplicate updates extracted certificate metadata without changing duplicate outcome", async () => {
  const store = createDb();
  const node = createPersistDuplicateNode({
    db: store.db as never,
    s3: s3 as never,
    bucket: "bucket",
  });

  await node(createState(["duplicate_source_file_revision"]));

  assert.deepEqual(store.operations, ["metadata-update", "insert-result"]);
  assert.equal(store.metadataUpdates.length, 1);
  assert.equal(
    "certificateBillingMonthMMYY" in (store.metadataUpdates[0] ?? {}),
    true,
  );
  assert.equal(store.insertedResults[0]?.outcome, "Duplicate");
  assert.equal(store.insertedResults[0]?.status, "duplicate");
});
