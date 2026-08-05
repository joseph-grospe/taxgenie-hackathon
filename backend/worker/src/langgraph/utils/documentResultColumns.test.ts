import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";

import type { DbClient } from "../../db/client.ts";
import {
  buildDocumentResultNormalizedColumns,
  resolvePayeeShortName,
  resolvePayorShortName,
} from "./documentResultColumns.ts";

function createDb(
  resultSets: Array<Array<{ shortName: string | null }>>,
  conditions?: SQL[],
) {
  let callCount = 0;

  return {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          conditions?.push(condition);
          return {
            orderBy: () => ({
              limit: async () => resultSets[callCount++] ?? [],
            }),
          };
        },
      }),
    }),
  } as unknown as DbClient;
}

test("buildDocumentResultNormalizedColumns normalizes values for persistence", () => {
  assert.deepEqual(
    buildDocumentResultNormalizedColumns(
      {
        periodEnd: "08-31-2025",
        payeeName: "  Therma Mobile, Inc.  ",
        payeeTin: "266-566-116-00000",
        payorName: "  Customer A  ",
        payorTin: "123-456-789-000",
      },
      "TMO",
      "CUST",
    ),
    {
      periodEnd: "2025-08-31",
      payeeName: "Therma Mobile, Inc.",
      payeeTin: "26656611600000",
      payeeShortName: "TMO",
      payorName: "Customer A",
      payorTin: "123456789000",
      payorShortName: "CUST",
    },
  );
});

test("buildDocumentResultNormalizedColumns falls back to periodCovered", () => {
  assert.equal(
    buildDocumentResultNormalizedColumns({
      periodCovered: "08-01-2025 to 08-31-2025",
    }).periodEnd,
    "2025-08-31",
  );
});

test("buildDocumentResultNormalizedColumns stores nulls for blank values", () => {
  assert.deepEqual(
    buildDocumentResultNormalizedColumns({
      periodEnd: "not a date",
      payeeName: " ",
      payeeTin: "---",
      payorName: null,
      payorTin: undefined,
    }),
    {
      periodEnd: null,
      payeeName: null,
      payeeTin: null,
      payeeShortName: null,
      payorName: null,
      payorTin: null,
      payorShortName: null,
    },
  );
});

test("resolvePayeeShortName uses the entity TIN match", async () => {
  const db = createDb([[{ shortName: " TMO " }]]);

  assert.equal(
    await resolvePayeeShortName(db, {
      payeeTin: "266-566-116-00000",
      payeeName: "Therma Mobile Inc.",
    }),
    "TMO",
  );
});

test("resolvePayeeShortName does not query by name when TIN is missing", async () => {
  const conditions: SQL[] = [];
  const db = createDb([[{ shortName: "TMO" }]], conditions);

  assert.equal(
    await resolvePayeeShortName(db, {
      payeeTin: "",
      payeeName: "  THERMA, MOBILE INC. ",
    }),
    null,
  );
  assert.equal(conditions.length, 0);
});

test("resolvePayeeShortName does not fall back to name when TIN lookup misses", async () => {
  const conditions: SQL[] = [];
  const db = createDb([[], [{ shortName: "TMO" }]], conditions);

  assert.equal(
    await resolvePayeeShortName(db, {
      payeeTin: "266-566-116-00000",
      payeeName: "Therma Mobile Inc.",
    }),
    null,
  );
  assert.equal(conditions.length, 1);
});

test("resolvePayorShortName uses the masterlist TIN match", async () => {
  const db = createDb([[{ shortName: " CUST " }]]);

  assert.equal(
    await resolvePayorShortName(db, {
      payorTin: "123-456-789-000",
      payorName: "Customer A",
    }),
    "CUST",
  );
});

test("resolvePayorShortName does not query by name when TIN is missing", async () => {
  const conditions: SQL[] = [];
  const db = createDb([[{ shortName: "CUST" }]], conditions);

  assert.equal(
    await resolvePayorShortName(db, {
      payorTin: "",
      payorName: "  CUSTOMER, A ",
    }),
    null,
  );
  assert.equal(conditions.length, 0);
});

test("resolvePayorShortName does not fall back to name when TIN lookup misses", async () => {
  const conditions: SQL[] = [];
  const db = createDb([[], [{ shortName: "CUST" }]], conditions);

  assert.equal(
    await resolvePayorShortName(db, {
      payorTin: "123-456-789-000",
      payorName: "Customer A",
    }),
    null,
  );
  assert.equal(conditions.length, 1);
});
