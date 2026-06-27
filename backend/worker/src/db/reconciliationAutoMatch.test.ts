import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAutomaticReconciliationMatch,
  resolveAutomaticReconciliationMatchInput,
} from "./reconciliationAutoMatch.ts";

type EligibleRow = {
  id: number;
  salesReportRunId: string | null;
  salesReportRowId?: number | null;
  invoiceNumber?: string;
  taxableSales: number;
  prepaidCWT: number;
  taxBase?: number | null;
  taxWithheld?: number | null;
  taxBaseDifference?: number;
  taxWithheldDifference?: number;
  emailSentAt?: Date | null;
};

function createDb(input: {
  rows?: Array<EligibleRow>;
  alreadyLinked?: boolean;
  summaries?: Array<{
    matchedCount: number;
    unmatchedCount: number;
    varianceTotal: number;
  }>;
}) {
  const reconciliationUpdates: Array<Record<string, unknown>> = [];
  const runUpdates: Array<Record<string, unknown>> = [];
  const linkInserts: Array<Record<string, unknown>> = [];
  let processedSummaryCount = 0;
  let selectCount = 0;

  const tx = {
    select: () => {
      selectCount += 1;
      if (selectCount === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => (input.alreadyLinked ? [{ id: 1 }] : []),
            }),
          }),
        };
      }

      if (selectCount === 2) {
        return {
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                where: () => ({
                  orderBy: async () => input.rows ?? [],
                }),
              }),
            }),
          }),
        };
      }

      return {
        from: () => ({
          where: async () => [
            input.summaries?.[processedSummaryCount++] ?? {
              matchedCount: 0,
              unmatchedCount: 0,
              varianceTotal: 0,
            },
          ],
        }),
      };
    },
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        linkInserts.push(values);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if ("matchedTaxRecordId" in values) {
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
    linkInserts,
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
      settlementReferenceNumber: "0044796",
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

test("resolveAutomaticReconciliationMatchInput reads derived certificate metadata for generic filenames", () => {
  assert.deepEqual(
    resolveAutomaticReconciliationMatchInput({
      originalFileName: "test_file_2307.pdf",
      metadata: {
        documentType: "BIR2307",
        normalizedIssuerShortname: "ACME",
        billingMonthMMYY: "0825",
      },
      normalized: {
        taxBase: 100,
        taxWithheld: "2.50",
      },
    }),
    {
      issuerShortName: "ACME",
      billingMonthMMYY: "0825",
      settlementReferenceNumber: null,
      taxBase: 100,
      taxWithheld: 2.5,
    },
  );
});

test("applyAutomaticReconciliationMatch links only the best eligible sales report row", async () => {
  const store = createDb({
    rows: [
      {
        id: 1,
        salesReportRunId: "run-1",
        salesReportRowId: 10,
        invoiceNumber: "SETT1",
        taxableSales: 100,
        prepaidCWT: -10,
        taxBase: null,
        taxWithheld: null,
        taxBaseDifference: -100,
        taxWithheldDifference: -10,
        emailSentAt: null,
      },
      {
        id: 2,
        salesReportRunId: "run-2",
        salesReportRowId: 11,
        invoiceNumber: "OTHER",
        taxableSales: 99,
        prepaidCWT: 5,
        taxBase: null,
        taxWithheld: null,
        taxBaseDifference: -99,
        taxWithheldDifference: -5,
        emailSentAt: null,
      },
    ],
    summaries: [{ matchedCount: 3, unmatchedCount: 2, varianceTotal: 22 }],
  });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 123,
    uploadId: "upload-1",
    sourceFileId: "source-1",
    originalFileName: "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    normalized: {
      taxBase: 101,
      taxWithheld: 12,
    },
  });

  assert.deepEqual(result, {
    status: "linked",
    rowCount: 0,
    runIds: ["run-1"],
  });
  assert.equal(store.linkInserts.length, 1);
  assert.deepEqual(
    {
      reconciliationResultId: store.linkInserts[0].reconciliationResultId,
      documentResultId: store.linkInserts[0].documentResultId,
      batchId: store.linkInserts[0].batchId,
      uploadId: store.linkInserts[0].uploadId,
      sourceFileId: store.linkInserts[0].sourceFileId,
      taxBase: store.linkInserts[0].taxBase,
      taxWithheld: store.linkInserts[0].taxWithheld,
    },
    {
      reconciliationResultId: 1,
      documentResultId: 123,
      batchId: "batch-1",
      uploadId: "upload-1",
      sourceFileId: "source-1",
      taxBase: 101,
      taxWithheld: 12,
    },
  );
  assert.equal(store.reconciliationUpdates.length, 1);
  assert.deepEqual(
    store.reconciliationUpdates.map((values) => ({
      matchedUploadBatchId: values.matchedUploadBatchId,
      matchedTaxRecordId: values.matchedTaxRecordId,
      taxBaseDifference: values.taxBaseDifference,
      taxWithheldDifference: values.taxWithheldDifference,
      hasDifference: values.hasDifference,
      matchStatus: values.matchStatus,
      matchedAt: values.matchedAt,
    })),
    [
      {
        matchedUploadBatchId: "batch-1",
        matchedTaxRecordId: 123,
        taxBaseDifference: 1,
        taxWithheldDifference: 2,
        hasDifference: true,
        matchStatus: "unmatched",
        matchedAt: null,
      },
    ],
  );
  assert.deepEqual(
    store.runUpdates.map((values) => ({
      matchedCount: values.matchedCount,
      unmatchedCount: values.unmatchedCount,
      varianceTotal: values.varianceTotal,
    })),
    [{ matchedCount: 3, unmatchedCount: 2, varianceTotal: 22 }],
  );
});

test("applyAutomaticReconciliationMatch can improve a matched row with remaining variance", async () => {
  const emailedAt = new Date("2026-06-01T00:00:00.000Z");
  const store = createDb({
    rows: [
      {
        id: 1,
        salesReportRunId: "run-1",
        salesReportRowId: 10,
        invoiceNumber: "SETT1",
        taxableSales: 100,
        prepaidCWT: 2,
        taxBase: 50,
        taxWithheld: 1,
        taxBaseDifference: -50,
        taxWithheldDifference: -1,
        emailSentAt: emailedAt,
      },
    ],
    summaries: [{ matchedCount: 1, unmatchedCount: 0, varianceTotal: 0 }],
  });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 124,
    uploadId: "upload-2",
    sourceFileId: "source-2",
    originalFileName: "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    normalized: {
      taxBase: 50,
      taxWithheld: 1,
    },
  });

  assert.deepEqual(result, {
    status: "matched",
    rowCount: 1,
    runIds: ["run-1"],
  });
  assert.equal(store.linkInserts.length, 1);
  assert.deepEqual(
    {
      taxBase: store.reconciliationUpdates[0].taxBase,
      taxWithheld: store.reconciliationUpdates[0].taxWithheld,
      taxBaseDifference: store.reconciliationUpdates[0].taxBaseDifference,
      taxWithheldDifference:
        store.reconciliationUpdates[0].taxWithheldDifference,
      hasDifference: store.reconciliationUpdates[0].hasDifference,
      matchStatus: store.reconciliationUpdates[0].matchStatus,
      matchedAt: store.reconciliationUpdates[0].matchedAt,
      emailSentAt: store.reconciliationUpdates[0].emailSentAt,
    },
    {
      taxBase: 100,
      taxWithheld: 2,
      taxBaseDifference: 0,
      taxWithheldDifference: 0,
      hasDifference: false,
      matchStatus: "matched",
      matchedAt: store.reconciliationUpdates[0].matchedAt,
      emailSentAt: emailedAt,
    },
  );
  assert.ok(store.reconciliationUpdates[0].matchedAt instanceof Date);
});

test("applyAutomaticReconciliationMatch reopens email only when remaining variance changes", async () => {
  const emailedAt = new Date("2026-06-01T00:00:00.000Z");
  const store = createDb({
    rows: [
      {
        id: 1,
        salesReportRunId: "run-1",
        salesReportRowId: 10,
        invoiceNumber: "SETT1",
        taxableSales: 100,
        prepaidCWT: 2,
        taxBase: 50,
        taxWithheld: 1,
        taxBaseDifference: -50,
        taxWithheldDifference: -1,
        emailSentAt: emailedAt,
      },
    ],
    summaries: [{ matchedCount: 0, unmatchedCount: 1, varianceTotal: 25.5 }],
  });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 125,
    uploadId: "upload-3",
    sourceFileId: "source-3",
    originalFileName: "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    normalized: {
      taxBase: 25,
      taxWithheld: 0.5,
    },
  });

  assert.deepEqual(result, {
    status: "linked",
    rowCount: 0,
    runIds: ["run-1"],
  });
  assert.deepEqual(
    {
      taxBase: store.reconciliationUpdates[0].taxBase,
      taxWithheld: store.reconciliationUpdates[0].taxWithheld,
      taxBaseDifference: store.reconciliationUpdates[0].taxBaseDifference,
      taxWithheldDifference:
        store.reconciliationUpdates[0].taxWithheldDifference,
      hasDifference: store.reconciliationUpdates[0].hasDifference,
      matchStatus: store.reconciliationUpdates[0].matchStatus,
      matchedAt: store.reconciliationUpdates[0].matchedAt,
      emailSentAt: store.reconciliationUpdates[0].emailSentAt,
    },
    {
      taxBase: 75,
      taxWithheld: 1.5,
      taxBaseDifference: -25,
      taxWithheldDifference: -0.5,
      hasDifference: true,
      matchStatus: "unmatched",
      matchedAt: null,
      emailSentAt: null,
    },
  );
});

test("applyAutomaticReconciliationMatch skips certificates already linked to an active result", async () => {
  const store = createDb({
    alreadyLinked: true,
    rows: [
      {
        id: 1,
        salesReportRunId: "run-1",
        taxableSales: 100,
        prepaidCWT: 2,
      },
    ],
  });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 123,
    uploadId: "upload-1",
    sourceFileId: "source-1",
    originalFileName: "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    normalized: {
      taxBase: 100,
      taxWithheld: 2,
    },
  });

  assert.deepEqual(result, { status: "skipped", rowCount: 0, runIds: [] });
  assert.equal(store.linkInserts.length, 0);
  assert.equal(store.reconciliationUpdates.length, 0);
});

test("applyAutomaticReconciliationMatch skips without eligible rows", async () => {
  const store = createDb({ rows: [] });

  const result = await applyAutomaticReconciliationMatch(store.db as never, {
    batchId: "batch-1",
    documentResultId: 123,
    uploadId: "upload-1",
    sourceFileId: "source-1",
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
