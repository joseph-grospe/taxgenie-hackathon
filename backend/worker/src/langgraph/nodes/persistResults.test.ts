import assert from "node:assert/strict";
import test from "node:test";

import { createPersistValidatedNode } from "./persistResults.ts";
import type { WorkflowState } from "../types.ts";

function createState(
  normalized: Record<string, unknown> = {
    periodEnd: "08-31-2025",
    payeeName: " Therma Mobile, Inc. ",
    payeeTin: "266-566-116-00000",
    payorName: " Customer A ",
    payorTin: "123-456-789-000",
  },
  uploadedAt: string | null | undefined = "2025-09-15T10:30:00.000Z",
): WorkflowState {
  return {
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "certificate.pdf",
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
}) {
  let insertedValues: Record<string, unknown> | undefined;
  let shortNameSelectCount = 0;
  let sequenceLockCount = 0;
  let processedCountSelectCount = 0;
  const shortNameRows = [
    input.payeeShortName ? [{ shortName: input.payeeShortName }] : [],
    input.payorShortName ? [{ shortName: input.payorShortName }] : [],
  ];
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
          values: (values: Record<string, unknown>) => Promise<void>;
        };
        execute: (query: unknown) => Promise<void>;
        select: () => {
          from: () => {
            innerJoin: () => {
              where: () => Promise<Array<{ processedCount: number }>>;
            };
          };
        };
      }) => Promise<void>,
    ) =>
      callback({
        execute: async () => {
          sequenceLockCount += 1;
        },
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: async () => {
                processedCountSelectCount += 1;
                return [{ processedCount: input.processedCount ?? 0 }];
              },
            }),
          }),
        }),
        insert: () => ({
          values: async (values: Record<string, unknown>) => {
            insertedValues = values;
          },
        }),
      }),
  };

  return {
    db,
    get insertedValues() {
      return insertedValues;
    },
    get sequenceLockCount() {
      return sequenceLockCount;
    },
    get processedCountSelectCount() {
      return processedCountSelectCount;
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
    "renamed/08312025/Customer_A_123456789000_08312025_6.pdf";

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
    "renamed/08312025/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(
    result.artifactKeys?.renamedPdf,
    "renamed/08312025/Customer_A_123456789000_08312025_1.pdf",
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
    "renamed/08312025/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(
    result.artifactKeys?.renamedPdf,
    "renamed/08312025/Customer_A_123456789000_08312025_1.pdf",
  );
  assert.equal(db.sequenceLockCount, 0);
  assert.equal(db.processedCountSelectCount, 0);
});
