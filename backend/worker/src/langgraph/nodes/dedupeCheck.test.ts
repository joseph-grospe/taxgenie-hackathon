import assert from "node:assert/strict";
import test from "node:test";

import { documentResults, intakeFiles } from "../../db/schema.ts";
import { createDedupeCheckNode } from "./dedupeCheck.ts";
import type { WorkflowState } from "../types.ts";

type QueryCall = {
  from?: unknown;
  innerJoin?: {
    table: unknown;
    on: unknown;
  };
  orderBy?: unknown[];
  limit?: number;
};

function createState(input: { sourceHash?: string } = {}): WorkflowState {
  return {
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "BIR2307_ACME_CLIENT_SETTLEMENT_0825_20250903.pdf",
    },
    jobId: "job-1",
    source: {
      bucket: "source-bucket",
      key: "uploads/file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      hash: input.sourceHash,
    },
    normalized: {},
    batchSummary: {
      totalPages: 1,
      certificatePageNumbers: [1],
      ignoredPageNumbers: [],
      validPageNumbers: [],
      failedPageNumbers: [],
      duplicatePageNumbers: [],
    },
  };
}

function createDb(input: {
  processedBir2307FileNameMatch: boolean;
  processedBir2307SourceHashMatch?: boolean;
}) {
  const calls: QueryCall[] = [];
  const db = {
    select: () => {
      const call: QueryCall = {};
      calls.push(call);

      const query = {
        from: (table: unknown) => {
          call.from = table;
          return query;
        },
        innerJoin: (table: unknown, on: unknown) => {
          call.innerJoin = { table, on };
          return query;
        },
        where: () => query,
        orderBy: (...orderBy: unknown[]) => {
          call.orderBy = orderBy;
          return query;
        },
        limit: async (limit: number) => {
          call.limit = limit;

          if (
            call.from === documentResults &&
            call.innerJoin?.table === intakeFiles
          ) {
            const callIndex = calls.indexOf(call);
            if (callIndex === 1) {
              return input.processedBir2307FileNameMatch ? [{ id: 1 }] : [];
            }

            if (callIndex === 2) {
              return input.processedBir2307SourceHashMatch ? [{ id: 1 }] : [];
            }
          }

          return [];
        },
      };

      return query;
    },
  };

  return { db, calls };
}

test("dedupeCheck ignores same-name uploads that do not have processed BIR 2307 results", async () => {
  const { db } = createDb({ processedBir2307FileNameMatch: false });
  const node = createDedupeCheckNode({ db: db as never });

  const result = await node(createState());

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.validation, undefined);
});

test("dedupeCheck ignores same-content uploads that only have errored or duplicate prior results", async () => {
  const { db } = createDb({
    processedBir2307FileNameMatch: false,
    processedBir2307SourceHashMatch: false,
  });
  const node = createDedupeCheckNode({ db: db as never });

  const result = await node(createState({ sourceHash: "ABC123" }));

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.validation, undefined);
});

test("dedupeCheck flags same-content files after a processed BIR 2307 result exists", async () => {
  const { db } = createDb({
    processedBir2307FileNameMatch: false,
    processedBir2307SourceHashMatch: true,
  });
  const node = createDedupeCheckNode({ db: db as never });

  const result = await node(createState({ sourceHash: "ABC123" }));

  assert.equal(result.decision?.route, "duplicate");
  assert.equal(
    result.validation?.checks.some(
      (check) => check.code === "DUPLICATE_UPLOADED_TWICE",
    ),
    true,
  );
});

test("dedupeCheck flags same-name files after a processed BIR 2307 result exists", async () => {
  const { db, calls } = createDb({ processedBir2307FileNameMatch: true });
  const node = createDedupeCheckNode({ db: db as never });

  const result = await node(createState());

  assert.equal(result.decision?.route, "duplicate");
  assert.equal(
    result.validation?.checks.some(
      (check) => check.code === "DUPLICATE_ORIGINAL_FILE_NAME",
    ),
    true,
  );

  const fileNameQuery = calls.find(
    (call) =>
      call.from === documentResults && call.innerJoin?.table === intakeFiles,
  );
  assert.ok(fileNameQuery);
  assert.equal(fileNameQuery.limit, 1);
  assert.equal(fileNameQuery.orderBy?.length, 2);
});
