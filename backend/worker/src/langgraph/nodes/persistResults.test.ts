import assert from "node:assert/strict";
import test from "node:test";

import { createPersistValidatedNode } from "./persistResults.ts";
import type { WorkflowState } from "../types.ts";

function createState(
  normalized: Record<string, unknown> = {
    periodStart: "08-01-2025",
    periodCovered: "08-01-2025 to 08-31-2025",
    periodEnd: "08-31-2025",
    monthOfQuarter: "third",
    payeeName: " Therma Mobile, Inc. ",
    payeeTin: "266-566-116-00000",
    payorName: " Customer A ",
    payorTin: "123-456-789-000",
  },
  uploadedAt: string | null | undefined = "2025-09-15T10:30:00.000Z",
  originalFileName = "certificate.pdf",
): WorkflowState {
  return {
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName,
      selectedEntity: {
        id: 1,
        shortName: "TMI",
        companyName: "Therma Mobile, Inc.",
        tin: "266566116000",
      },
      uploadedAt: uploadedAt as string,
    },
    jobId: "job-1",
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        sourceContentBase64: Buffer.from("pdf").toString("base64"),
        normalized,
        validation: {
          status: "valid",
          reasons: [],
          checks: [],
        },
      },
    ],
  };
}

function createDb(input: {
  payeeShortName?: string | null;
  payorShortName?: string | null;
  processedCount?: number;
  autoMatchRows?: Array<{
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
  }>;
  autoMatchSummaries?: Array<{
    matchedCount: number;
    unmatchedCount: number;
    varianceTotal: number;
  }>;
  autoMatchError?: Error;
}) {
  let insertedValues: Record<string, unknown> | undefined;
  const metadataUpdates: Array<Record<string, unknown>> = [];
  const reconciliationUpdates: Array<Record<string, unknown>> = [];
  const runSummaryUpdates: Array<Record<string, unknown>> = [];
  const reconciliationLinkInserts: Array<Record<string, unknown>> = [];
  let shortNameSelectCount = 0;
  let sequenceLockCount = 0;
  let processedCountSelectCount = 0;
  let transactionCount = 0;
  let processedSummaryCount = 0;
  const shortNameRows = [
    input.payeeShortName ? [{ shortName: input.payeeShortName }] : [],
    input.payorShortName ? [{ shortName: input.payorShortName }] : [],
  ];
  const handleInsertValues = (values: Record<string, unknown>) => {
    insertedValues = values;

    return {
      returning: async () => [{ id: 123 }],
    };
  };
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
    transaction: async (
      callback: (tx: {
        insert: () => {
          values: (values: Record<string, unknown>) => {
            returning: () => Promise<Array<{ id: number }>>;
          };
        };
        execute: (query: unknown) => Promise<void>;
        select: () => Record<string, unknown>;
        update: () => {
          set: (values: Record<string, unknown>) => {
            where: () => {
              returning?: () => Promise<Array<Record<string, unknown>>>;
            };
          };
        };
      }) => Promise<void>,
    ) => {
      transactionCount += 1;
      if (transactionCount > 1 && input.autoMatchError) {
        throw input.autoMatchError;
      }

      let transactionSelectCount = 0;
      const isAutoMatchTransaction = transactionCount > 1;

      return callback({
        execute: async () => {
          sequenceLockCount += 1;
        },
        select: () => {
          transactionSelectCount += 1;

          if (isAutoMatchTransaction && transactionSelectCount === 1) {
            return {
              from: () => ({
                where: () => ({
                  limit: async () => [],
                }),
              }),
            };
          }

          if (isAutoMatchTransaction && transactionSelectCount === 2) {
            return {
              from: () => ({
                innerJoin: () => ({
                  innerJoin: () => ({
                    where: () => ({
                      orderBy: async () => input.autoMatchRows ?? [],
                    }),
                  }),
                }),
              }),
            };
          }

          return {
            from: () => ({
              innerJoin: () => ({
                innerJoin: () => ({
                  where: () => ({
                    orderBy: async () => input.autoMatchRows ?? [],
                  }),
                }),
                where: async () => {
                  processedCountSelectCount += 1;
                  return [{ processedCount: input.processedCount ?? 0 }];
                },
              }),
              where: async () => [
                input.autoMatchSummaries?.[processedSummaryCount++] ?? {
                  matchedCount: 0,
                  unmatchedCount: 0,
                  varianceTotal: 0,
                },
              ],
            }),
          };
        },
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            if (isAutoMatchTransaction) {
              reconciliationLinkInserts.push(values);
              return {};
            }

            return handleInsertValues(values);
          },
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              if ("matchedTaxRecordId" in values) {
                const row = input.autoMatchRows?.[reconciliationUpdates.length];
                reconciliationUpdates.push(values);
                return {
                  returning: async () =>
                    row
                      ? [{ id: row.id, salesReportRunId: row.salesReportRunId }]
                      : [],
                };
              }

              if ("matchedCount" in values) {
                runSummaryUpdates.push(values);
                return {};
              }

              if ("certificateDocumentType" in values) {
                metadataUpdates.push(values);
                return {};
              }

              insertedValues = {
                ...insertedValues,
                ...values,
              };
              return {};
            },
          }),
        }),
      });
    },
    insert: () => ({
      values: handleInsertValues,
    }),
  };

  return {
    db,
    get insertedValues() {
      return insertedValues;
    },
    get metadataUpdates() {
      return metadataUpdates;
    },
    get sequenceLockCount() {
      return sequenceLockCount;
    },
    get processedCountSelectCount() {
      return processedCountSelectCount;
    },
    get reconciliationUpdates() {
      return reconciliationUpdates;
    },
    get reconciliationLinkInserts() {
      return reconciliationLinkInserts;
    },
    get runSummaryUpdates() {
      return runSummaryUpdates;
    },
  };
}

test("persistResults supplies normalized document result columns", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: "CUST",
  });
  const s3 = {
    send: async () => undefined,
  };
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });
  const state = createState();

  await node(state);

  assert.equal(db.insertedValues?.periodEnd, "2025-08-31");
  assert.equal(
    (
      (db.insertedValues?.payload as Record<string, unknown>)?.normalized as
        | Record<string, unknown>
        | undefined
    )?.periodStart,
    "08-01-2025",
  );
  assert.equal(
    (
      (db.insertedValues?.payload as Record<string, unknown>)?.normalized as
        | Record<string, unknown>
        | undefined
    )?.monthOfQuarter,
    "third",
  );
  assert.equal(db.insertedValues?.payeeName, "Therma Mobile, Inc.");
  assert.equal(db.insertedValues?.payeeTin, "26656611600000");
  assert.equal(db.insertedValues?.payeeShortName, "TMO");
  assert.equal(db.insertedValues?.payorName, "Customer A");
  assert.equal(db.insertedValues?.payorTin, "123456789000");
  assert.equal(db.insertedValues?.payorShortName, "CUST");
});

test("persistResults uses the next payor monthly processed number in artifact keys", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: "CUST",
    processedCount: 5,
  });
  const s3Keys: Array<string | undefined> = [];
  const s3 = {
    send: async (command: { input?: { Key?: string } }) => {
      s3Keys.push(command.input?.Key);
    },
  };
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });

  const result = await node(createState());
  const renamedPdf =
    "v2/entities/tmi-1/customers/cust/certificates/2025-08/11111111-1111-1111-1111-111111111111/123/unsigned/Customer_A_123456789000_08312025_6.pdf";

  assert.equal(db.insertedValues?.finalKey, renamedPdf);
  assert.equal(result.artifactKeys?.renamedPdf, renamedPdf);
  assert.equal(s3Keys.includes(renamedPdf), true);
  assert.equal(db.sequenceLockCount, 1);
  assert.equal(db.processedCountSelectCount, 1);
});

test("persistResults falls back to processed number 1 when payor short name is missing", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: null,
    processedCount: 5,
  });
  const s3 = {
    send: async () => undefined,
  };
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });

  const result = await node(createState());

  assert.equal(
    db.insertedValues?.finalKey,
    "v2/entities/tmi-1/customers/customer-unknown/certificates/2025-08/11111111-1111-1111-1111-111111111111/123/unsigned/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(
    result.artifactKeys?.renamedPdf,
    "v2/entities/tmi-1/customers/customer-unknown/certificates/2025-08/11111111-1111-1111-1111-111111111111/123/unsigned/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(db.sequenceLockCount, 0);
  assert.equal(db.processedCountSelectCount, 0);
});

test("persistResults falls back to processed number 1 when upload date is missing", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: "CUST",
    processedCount: 5,
  });
  const s3 = {
    send: async () => undefined,
  };
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });

  const result = await node(createState(undefined, null));

  assert.equal(
    db.insertedValues?.finalKey,
    "v2/entities/tmi-1/customers/cust/certificates/2025-08/11111111-1111-1111-1111-111111111111/123/unsigned/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(
    result.artifactKeys?.renamedPdf,
    "v2/entities/tmi-1/customers/cust/certificates/2025-08/11111111-1111-1111-1111-111111111111/123/unsigned/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(db.sequenceLockCount, 0);
  assert.equal(db.processedCountSelectCount, 0);
});

test("persistResults does not update reconciliation rows", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: "ACME",
  });
  const s3 = {
    send: async () => undefined,
  };
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });

  await node(
    createState({
      periodEnd: "08-31-2025",
      payeeName: "Therma Mobile, Inc.",
      payeeTin: "266-566-116-00000",
      payorName: "Customer A",
      payorTin: "123-456-789-000",
      taxBase: 101,
      taxWithheld: 2.5,
    }),
  );

  assert.equal(db.reconciliationUpdates.length, 0);
});

test("persistResults invokes reconciliation auto-match for BIR2307 certificates", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: "ACME",
    autoMatchRows: [
      {
        id: 42,
        salesReportRunId: "run-1",
        taxableSales: 100,
        prepaidCWT: -2.5,
      },
    ],
    autoMatchSummaries: [
      {
        matchedCount: 1,
        unmatchedCount: 0,
        varianceTotal: 0,
      },
    ],
  });
  const s3 = {
    send: async () => undefined,
  };
  const debugMessages: Array<Record<string, unknown> | undefined> = [];
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: (_message: string, meta?: Record<string, unknown>) => {
      debugMessages.push(meta);
    },
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });

  await node(
    createState(
      {
        periodEnd: "08-31-2025",
        payeeName: "Therma Mobile, Inc.",
        payeeTin: "266-566-116-00000",
        payorName: "Customer A",
        payorTin: "123-456-789-000",
        taxBase: 100,
        taxWithheld: 2.5,
      },
      "2025-09-15T10:30:00.000Z",
      "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    ),
  );

  assert.equal(db.reconciliationUpdates.length, 1);
  assert.equal(db.reconciliationUpdates[0]?.matchedTaxRecordId, 123);
  assert.equal(db.reconciliationUpdates[0]?.matchStatus, "matched");
  assert.equal(db.runSummaryUpdates.length, 1);
  assert.deepEqual(debugMessages[0], {
    jobId: "job-1",
    sourceFileId: "source-1",
    documentResultId: 123,
    rowCount: 1,
    runIds: ["run-1"],
  });
});

test("persistResults uses derived metadata for generic filename reconciliation auto-match", async () => {
  const db = createDb({
    payeeShortName: "TMI",
    payorShortName: "ACME",
    autoMatchRows: [
      {
        id: 42,
        salesReportRunId: "run-1",
        taxableSales: 100,
        prepaidCWT: -2.5,
      },
    ],
    autoMatchSummaries: [
      {
        matchedCount: 1,
        unmatchedCount: 0,
        varianceTotal: 0,
      },
    ],
  });
  const s3 = {
    send: async () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  });

  await node(
    createState(
      {
        periodEnd: "09-30-2025",
        monthOfQuarter: "second",
        payeeName: "Therma Mobile, Inc.",
        payeeTin: "266-566-116-00000",
        payorName: "Customer A",
        payorTin: "123-456-789-000",
        taxBase: 100,
        taxWithheld: 2.5,
      },
      "2025-09-15T10:30:00.000Z",
      "test_file_2307.pdf",
    ),
  );

  assert.equal(db.metadataUpdates.length, 1);
  assert.equal(db.reconciliationUpdates.length, 1);
  assert.equal(db.reconciliationUpdates[0]?.matchedTaxRecordId, 123);
  assert.equal(db.runSummaryUpdates.length, 1);
});

test("persistResults keeps certificate persistence when auto-match fails", async () => {
  const db = createDb({
    payeeShortName: "TMO",
    payorShortName: "ACME",
    autoMatchError: new Error("auto-match failed"),
  });
  const s3 = {
    send: async () => undefined,
  };
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const logger = {
    info: () => undefined,
    warn: (_message: string, meta?: Record<string, unknown>) => {
      warnings.push(meta);
    },
    error: () => undefined,
    debug: () => undefined,
  };
  const node = createPersistValidatedNode({
    db: db.db as never,
    s3: s3 as never,
    bucket: "bucket",
    logger,
  });

  const result = await node(
    createState(
      {
        periodEnd: "08-31-2025",
        payeeName: "Therma Mobile, Inc.",
        payeeTin: "266-566-116-00000",
        payorName: "Customer A",
        payorTin: "123-456-789-000",
        taxBase: 100,
        taxWithheld: 2.5,
      },
      "2025-09-15T10:30:00.000Z",
      "BIR2307_ACME_TMO_SETT1_0825_20250903.pdf",
    ),
  );

  assert.equal(result.decision?.terminalStatus, "Done");
  assert.equal(db.insertedValues?.finalKey, result.artifactKeys?.renamedPdf);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.error, "auto-match failed");
});
