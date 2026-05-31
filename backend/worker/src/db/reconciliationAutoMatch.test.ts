import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAutomaticReconciliationMatch,
  resolveAutomaticReconciliationMatchInput,
} from "./reconciliationAutoMatch.ts";

type EligibleRow = {
  id: number;
  salesReportRunId: string | null;
  taxableSales: number;
  prepaidCWT: number;
};

function createDb(input: {
  rows?: Array<EligibleRow>;
  summaries?: Array<{
    matchedCount: number;
    unmatchedCount: number;
    varianceTotal: number;
  }>;
}) {
  const reconciliationUpdates: Array<Record<string, unknown>> = [];
  const runUpdates: Array<Record<string, unknown>> = [];
  let processedSummaryCount = 0;

  const tx = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => input.rows ?? [],
            }),
          }),
        }),
        where: async () => [
          input.summaries?.[processedSummaryCount++] ?? {
            matchedCount: 0,
            unmatchedCount: 0,
            varianceTotal: 0,
          },
        ],
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if ("matchStatus" in values) {
            const row = input.rows?.[reconciliationUpdates.length];
            reconciliationUpdates.push(values);
            return {
              returning: async () =>
                row
                  ? [{ id: row.id, salesReportRunId: row.salesReportRunId }]
                  : [],
            };
          }

          runUpdates.push(values);
          return {};
        },
      }),
    }),
  };
  const db = {
    transaction: async <TResult>(
      callback: (transaction: typeof tx) => Promise<TResult>,
    ) => callback(tx),
  };

  return {
    db,
    reconciliationUpdates,
    runUpdates,
  };
}

test("resolveAutomaticReconciliationMatchInput reads BIR2307 filename metadata", () => {
  assert.deepEqual(
    resolveAutomaticReconciliationMatchInput({
      originalFileName: "BIR2307_BILECO_EAUC_0044796_0825_20251003 (1).pdf",
      normalized: {
        taxBase: "1,000.25",
        taxWithheld: 20.5,
      },
    }),
    {
      issuerShortName: "BILECO",
      billingMonthMMYY: "0825",
      taxBase: 1000.25,
      taxWithheld: 20.5,
    },
  );
});

test("resolveAutomaticReconciliationMatchInput skips non-BIR2307 filenames", () => {
  assert.equal(
    resolveAutomaticReconciliationMatchInput({
      originalFileName: "invoice.pdf",
      normalized: {
        taxBase: 100,
        taxWithheld: 10,
      },
    }),
    null,
  );
});

test("resolveAutomaticReconciliationMatchInput skips without a normalized issuer key", () => {
  assert.equal(
    resolveAutomaticReconciliationMatchInput({
      originalFileName: "BIR2307_---_TMO_SETT1_0825_20250903.pdf",
      normalized: {
        taxBase: 100,
        taxWithheld: 10,
      },
    }),
    null,
  );
});

test("applyAutomaticReconciliationMatch matches all eligible sales report rows", async () => {
  const store = createDb({
    rows: [
      {
        id: 1,
        salesReportRunId: "run-1",
        taxableSales: 100,
        prepaidCWT: -10,
      },
      {
        id: 2,
        salesReportRunId: "run-2",
        taxableSales: 99,
        prepaidCWT: 5,
      },
    ],
    summaries: [
      { matchedCount: 4, unmatchedCount: 1, varianceTotal: 22 },
      { matchedCount: 7, unmatchedCount: 0, varianceTotal: 30.5 },
    ],
  });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 123,
    originalFileName: "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    normalized: {
      taxBase: 101,
      taxWithheld: 12,
    },
  });

  assert.deepEqual(result, {
    status: "matched",
    rowCount: 2,
    runIds: ["run-1", "run-2"],
  });
  assert.equal(store.reconciliationUpdates.length, 2);
  assert.deepEqual(
    store.reconciliationUpdates.map((values) => ({
      matchedUploadBatchId: values.matchedUploadBatchId,
      matchedTaxRecordId: values.matchedTaxRecordId,
      taxBaseDifference: values.taxBaseDifference,
      taxWithheldDifference: values.taxWithheldDifference,
      hasDifference: values.hasDifference,
      matchStatus: values.matchStatus,
    })),
    [
      {
        matchedUploadBatchId: "batch-1",
        matchedTaxRecordId: 123,
        taxBaseDifference: 1,
        taxWithheldDifference: 2,
        hasDifference: true,
        matchStatus: "matched",
      },
      {
        matchedUploadBatchId: "batch-1",
        matchedTaxRecordId: 123,
        taxBaseDifference: 2,
        taxWithheldDifference: 7,
        hasDifference: true,
        matchStatus: "matched",
      },
    ],
  );
  assert.deepEqual(
    store.runUpdates.map((values) => ({
      matchedCount: values.matchedCount,
      unmatchedCount: values.unmatchedCount,
      varianceTotal: values.varianceTotal,
    })),
    [
      { matchedCount: 4, unmatchedCount: 1, varianceTotal: 22 },
      { matchedCount: 7, unmatchedCount: 0, varianceTotal: 30.5 },
    ],
  );
});

test("applyAutomaticReconciliationMatch skips without eligible rows", async () => {
  const store = createDb({ rows: [] });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 123,
    originalFileName: "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    normalized: {
      taxBase: 101,
      taxWithheld: 12,
    },
  });

  assert.deepEqual(result, { status: "skipped", rowCount: 0, runIds: [] });
  assert.equal(store.reconciliationUpdates.length, 0);
  assert.equal(store.runUpdates.length, 0);
});
