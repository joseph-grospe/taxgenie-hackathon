import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { AtcRuleMap } from "../../db/atcCodes.ts";
import type { DbClient } from "../../db/client.ts";
import {
  documentResults,
  entities,
  extractedCertificates,
  masterlist,
} from "../../db/schema.ts";
import type { WorkflowState } from "../types.ts";
import {
  SANITIZED_TWO_ATC_EXTRACTION_TOTALS,
  SANITIZED_TWO_ATC_TAX_ROWS,
  SANITIZED_TWO_ATC_WE_TOTALS,
} from "../testFixtures/sanitizedTwoAtcCertificate.ts";
import { createProcessCertificatesNode } from "./processCertificates.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const toAtcRules = (rates: Record<string, number>): AtcRuleMap =>
  Object.fromEntries(
    Object.entries(rates).map(([code, rate]) => [
      code,
      {
        code,
        taxType: code.startsWith("WV") ? "WV" : "WE",
        rate,
      },
    ]),
  );

const masterlistMatch = {
  region: "Mindanao",
  entity: "Customer",
  shortName: "DECORP",
  customerName: "DEMO CUSTOMER",
  tin: "0002025240000",
  address: null,
  emailAddress: null,
  isGovernment: false,
};

interface DbOptions {
  sourceDuplicate?: boolean;
  certificateDuplicate?: boolean;
  masterlistMatches?: Array<typeof masterlistMatch>;
  masterlistResultSets?: Array<Array<typeof masterlistMatch> | Error>;
  masterlistError?: Error;
  masterlistLookupCapture?: {
    conditions: SQL[];
    orderBy: SQL[][];
    limits: number[];
  };
  queryCounts?: {
    sourceDuplicate: number;
    certificateDuplicate: number;
    masterlist: number;
  };
  duplicateWhere?: {
    source?: SQL;
    certificate?: SQL;
  };
  duplicateOrderBy?: {
    source?: SQL[];
    certificate?: SQL[];
  };
}

function createDb(options: DbOptions = {}): DbClient {
  let masterlistLookupCallCount = 0;

  return {
    select: (selection?: unknown) => {
      let table: unknown;
      const builder = {
        from: (nextTable: unknown) => {
          table = nextTable;
          return builder;
        },
        innerJoin: () => builder,
        where: (condition: SQL) => {
          if (table === documentResults && options.duplicateWhere) {
            options.duplicateWhere.source = condition;
          }
          if (table === extractedCertificates && options.duplicateWhere) {
            options.duplicateWhere.certificate = condition;
          }
          if (
            table === masterlist &&
            selection === undefined &&
            options.masterlistLookupCapture
          ) {
            options.masterlistLookupCapture.conditions.push(condition);
          }
          return builder;
        },
        orderBy: (...expressions: SQL[]) => {
          if (table === documentResults && options.duplicateOrderBy) {
            options.duplicateOrderBy.source = expressions;
          }
          if (table === extractedCertificates && options.duplicateOrderBy) {
            options.duplicateOrderBy.certificate = expressions;
          }
          if (
            table === masterlist &&
            selection === undefined &&
            options.masterlistLookupCapture
          ) {
            options.masterlistLookupCapture.orderBy.push(expressions);
          }
          return builder;
        },
        limit: async (limit: number) => {
          if (table === documentResults) {
            if (options.queryCounts) {
              options.queryCounts.sourceDuplicate += 1;
            }
            return options.sourceDuplicate ? [{ id: 10 }] : [];
          }
          if (table === extractedCertificates) {
            if (options.queryCounts) {
              options.queryCounts.certificateDuplicate += 1;
            }
            return options.certificateDuplicate ? [{ id: 20 }] : [];
          }
          if (table === entities) {
            return [{ shortName: "AESI" }];
          }
          if (table === masterlist) {
            if (options.queryCounts) {
              options.queryCounts.masterlist += 1;
            }
            if (selection === undefined) {
              if (options.masterlistError) {
                throw options.masterlistError;
              }
              options.masterlistLookupCapture?.limits.push(limit);
              const result = options.masterlistResultSets?.[
                masterlistLookupCallCount
              ] ??
                options.masterlistMatches ?? [masterlistMatch];
              masterlistLookupCallCount += 1;
              if (result instanceof Error) {
                throw result;
              }
              return result;
            }
            return [masterlistMatch];
          }
          return [];
        },
      };
      return builder;
    },
  } as unknown as DbClient;
}

function createState(): WorkflowState {
  const certificate = {
    certificateKey: "certificate-1",
    pageNumbers: [1],
    period: {
      start: "2026-04-01",
      end: "2026-06-30",
      monthOfQuarter: "first" as const,
    },
    payee: {
      name: "DEMO PAYEE",
      tin: "0050316630000",
      address: null,
      zip: null,
    },
    payor: {
      name: "DEMO CUSTOMER",
      tin: "0002025240000",
      address: null,
      zip: null,
    },
    taxRows: [
      {
        lineNumber: 1,
        pageNumber: 1,
        atcCode: "WC160",
        description: null,
        monthlyAmounts: {
          first: "100.00",
          second: null,
          third: null,
        },
        taxBase: "100.00",
        taxRate: "0.020000",
        taxWithheld: "2.00",
      },
    ],
    primaryAtcCode: "WC160",
    totals: { taxBase: "100.00", taxWithheld: "2.00" },
    signer: {
      printedName: "SIGNER NAME",
      title: "Manager",
      tin: "901327847000",
      companyName: null,
      signature: {
        present: true,
        confidence: 0.99,
        pageNumber: 1,
        source: "gemini" as const,
      },
    },
    confidence: {
      period: 0.99,
      payee: 0.98,
      payor: 0.98,
      taxRows: 0.96,
      signer: 0.91,
    },
    evidence: {},
    warnings: [],
  };

  return {
    event: {
      version: "v1",
      eventId: "event-1",
      traceId: "trace-1",
      source: "manual-upload",
      batchId: "11111111-1111-4111-8111-111111111111",
      uploadId: "22222222-2222-4222-8222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "certificate.pdf",
      modifiedTime: "2026-07-28T00:00:00.000Z",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      artifactUri: "s3://source/certificate.pdf",
      selectedEntity: {
        id: 1,
        shortName: "AESI",
        companyName: "DEMO PAYEE",
        tin: "0050316630000",
      },
      uploadedByUserId: "user-1",
      uploadedAt: "2026-07-28T00:00:00.000Z",
      receivedAt: "2026-07-28T00:00:00.000Z",
    },
    jobId: "job-1",
    source: {
      uri: "s3://source/certificate.pdf",
      bucket: "source",
      key: "certificate.pdf",
      mimeType: "application/pdf",
      hash: "a".repeat(64),
    },
    extractionResult: {
      schemaVersion: 1,
      classification: {
        documentType: "BIR_2307",
        confidence: 0.99,
        pageCount: 1,
      },
      certificates: [certificate],
    },
    certificates: [
      {
        ordinal: 1,
        extracted: structuredClone(certificate),
        effective: structuredClone(certificate),
        status: "accepted",
        reasonCodes: [],
        signatureFallback: {
          status: "not_detected",
          promoted: false,
          minimumConfidence: 0.86,
          providerSignaturePresent: false,
        },
      },
    ],
  };
}

test("masterlist validates TIN, name, and same-record identity independently", async () => {
  const capture = { conditions: [], orderBy: [], limits: [] };
  const node = createProcessCertificatesNode({
    db: createDb({ masterlistLookupCapture: capture }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());
  const certificate = result.certificates?.[0];
  const lookup = certificate?.masterlistLookup;
  const dialect = new PgDialect();
  const tinQuery = dialect.sqlToQuery(capture.conditions[0]!);
  const nameQuery = dialect.sqlToQuery(capture.conditions[1]!);
  const identityQuery = dialect.sqlToQuery(capture.conditions[2]!);

  assert.equal(certificate?.status, "accepted");
  assert.equal(lookup?.status, "matched");
  assert.equal(lookup?.query, "000202524|DEMO CUSTOMER");
  assert.equal(lookup?.tinLookup.status, "matched");
  assert.equal(lookup?.nameLookup.status, "matched");
  assert.equal(lookup?.matchCount, 1);
  assert.equal(certificate?.payorShortName, "DECORP");
  assert.equal(capture.conditions.length, 3);
  assert.match(tinQuery.sql, /regexp_replace/u);
  assert.equal(tinQuery.params.includes("000202524%"), true);
  assert.match(nameQuery.sql, /ILIKE/u);
  assert.equal(nameQuery.params.includes("%democustomer%"), true);
  assert.match(identityQuery.sql, /regexp_replace/u);
  assert.match(identityQuery.sql, /ILIKE/u);
  assert.deepEqual(capture.limits, [10, 10, 10]);
  assert.deepEqual(
    capture.orderBy[0]?.map((expression) => dialect.sqlToQuery(expression).sql),
    ['"masterlist"."short_name" asc', '"masterlist"."customer_name" asc'],
  );
});

test("masterlist name match does not fall back for an unmatched TIN", async () => {
  const capture = { conditions: [], orderBy: [], limits: [] };
  const nameMatch = {
    ...masterlistMatch,
    shortName: "DCI",
    customerName: "THE DEMO CUSTOMER INCORPORATED",
    tin: "9998887770000",
  };
  const node = createProcessCertificatesNode({
    db: createDb({
      masterlistResultSets: [[], [nameMatch]],
      masterlistLookupCapture: capture,
    }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificates![0]!.effective.payor.name = "  Demo, Customer Inc.  ";

  const result = await node(state);
  const lookup = result.certificates?.[0]?.masterlistLookup;
  const dialect = new PgDialect();
  const tinQuery = dialect.sqlToQuery(capture.conditions[0]!);
  const nameQuery = dialect.sqlToQuery(capture.conditions[1]!);

  assert.equal(result.certificates?.[0]?.status, "error");
  assert.equal(result.certificates?.[0]?.payorShortName, null);
  assert.equal(lookup?.status, "not_found");
  assert.equal(lookup?.tinLookup.status, "not_found");
  assert.equal(lookup?.nameLookup.status, "matched");
  assert.equal(lookup?.matchCount, 0);
  assert.deepEqual(lookup?.matches, []);
  assert.equal(capture.conditions.length, 2);
  assert.equal(tinQuery.params.includes("000202524%"), true);
  assert.match(nameQuery.sql, /ILIKE/u);
  assert.equal(nameQuery.params.includes("%democustomerinc%"), true);
  assert.deepEqual(capture.limits, [10, 10]);
  assert.deepEqual(
    result.certificates?.[0]?.validation?.checks.find(
      (check) => check.code === "MASTERLIST_PAYOR_TIN_MATCH",
    ),
    {
      code: "MASTERLIST_PAYOR_TIN_MATCH",
      passed: false,
      message: 'Payor TIN prefix "000202524" was not found in the masterlist',
    },
  );
});

test("masterlist name match does not replace a skipped short TIN lookup", async () => {
  const capture = { conditions: [], orderBy: [], limits: [] };
  const node = createProcessCertificatesNode({
    db: createDb({ masterlistLookupCapture: capture }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificates![0]!.effective.payor.tin = "123-456";
  state.certificates![0]!.effective.payor.name = "Demo Customer";

  const result = await node(state);
  const lookup = result.certificates?.[0]?.masterlistLookup;
  const nameQuery = new PgDialect().sqlToQuery(capture.conditions[0]!);

  assert.equal(result.certificates?.[0]?.status, "error");
  assert.equal(result.certificates?.[0]?.payorShortName, null);
  assert.equal(lookup?.status, "not_found");
  assert.equal(lookup?.tinLookup.status, "skipped");
  assert.equal(lookup?.nameLookup.status, "matched");
  assert.equal(capture.conditions.length, 1);
  assert.match(nameQuery.sql, /ILIKE/u);
  assert.equal(nameQuery.params.includes("%democustomer%"), true);
});

test("masterlist rejects TIN and name matches from different records", async () => {
  const tinMatch = {
    ...masterlistMatch,
    shortName: "TIN-ROW",
    customerName: "OTHER CUSTOMER",
  };
  const nameMatch = {
    ...masterlistMatch,
    shortName: "NAME-ROW",
    tin: "9998887770000",
  };
  const node = createProcessCertificatesNode({
    db: createDb({
      masterlistResultSets: [[tinMatch], [nameMatch], []],
    }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());
  const certificate = result.certificates?.[0];
  const lookup = certificate?.masterlistLookup;
  const identityCheck = certificate?.validation?.checks.find(
    (check) => check.code === "MASTERLIST_PAYOR_IDENTITY_MATCH",
  );

  assert.equal(certificate?.status, "error");
  assert.equal(certificate?.payorShortName, null);
  assert.equal(lookup?.status, "not_found");
  assert.equal(lookup?.tinLookup.status, "matched");
  assert.equal(lookup?.nameLookup.status, "matched");
  assert.deepEqual(identityCheck, {
    code: "MASTERLIST_PAYOR_IDENTITY_MATCH",
    passed: false,
    message: "Payor TIN and name match different masterlist records.",
  });
  assert.ok(
    certificate?.reasonCodes.includes("masterlist_payor_identity_mismatch"),
  );
});

test("both missing masterlist records produce separate failed checks", async () => {
  const node = createProcessCertificatesNode({
    db: createDb({ masterlistResultSets: [[], []] }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());
  const failedMasterlistChecks = result.certificates?.[0]?.validation?.checks
    .filter((check) => !check.passed)
    .filter((check) => check.code.startsWith("MASTERLIST_PAYOR_"));

  assert.deepEqual(
    failedMasterlistChecks?.map((check) => check.code),
    ["MASTERLIST_PAYOR_TIN_MATCH", "MASTERLIST_PAYOR_NAME_MATCH"],
  );
});

test("masterlist field lookup errors do not suppress the other field result", async () => {
  const node = createProcessCertificatesNode({
    db: createDb({
      masterlistResultSets: [
        new Error("TIN lookup unavailable"),
        [masterlistMatch],
      ],
    }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());
  const lookup = result.certificates?.[0]?.masterlistLookup;

  assert.equal(result.certificates?.[0]?.status, "error");
  assert.equal(lookup?.status, "error");
  assert.equal(lookup?.tinLookup.status, "error");
  assert.equal(lookup?.nameLookup.status, "matched");
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes("masterlist_lookup_failed"),
  );
});

test("WV020 ignores a government match found only by payor name", async () => {
  const nameOnlyGovernmentMatch = {
    ...masterlistMatch,
    tin: "9998887770000",
    isGovernment: true,
  };
  const node = createProcessCertificatesNode({
    db: createDb({ masterlistResultSets: [[], [nameOnlyGovernmentMatch]] }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02, WV020: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificates![0]!.effective.taxRows[0]!.atcCode = "WV020";

  const result = await node(state);
  const certificate = result.certificates?.[0];
  const governmentCheck = certificate?.validation?.checks.find(
    (check) => check.code === "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
  );

  assert.equal(certificate?.status, "error");
  assert.equal(certificate?.masterlistLookup?.status, "not_found");
  assert.equal(governmentCheck, undefined);
});

test("multi-ATC certificates validate every row and derive WE reconciliation totals", async () => {
  const node = createProcessCertificatesNode({
    db: createDb({
      masterlistMatches: [{ ...masterlistMatch, isGovernment: true }],
    }),
    getAtcRules: async () => toAtcRules({ WC157: 0.02, WV020: 0.05 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const certificate = state.certificates![0]!;
  certificate.effective.taxRows = structuredClone(SANITIZED_TWO_ATC_TAX_ROWS);
  certificate.effective.primaryAtcCode = "WV020";
  certificate.effective.totals = SANITIZED_TWO_ATC_EXTRACTION_TOTALS;

  const result = await node(state);
  const processed = result.certificates?.[0];

  assert.equal(processed?.status, "accepted");
  assert.equal(processed?.effective.primaryAtcCode, "WC157");
  assert.deepEqual(
    processed?.reconciliationTotals,
    SANITIZED_TWO_ATC_WE_TOTALS,
  );
  assert.deepEqual(
    processed?.effective.totals,
    SANITIZED_TWO_ATC_EXTRACTION_TOTALS,
  );
  assert.deepEqual(processed?.extracted.totals, {
    taxBase: "100.00",
    taxWithheld: "2.00",
  });
  assert.deepEqual(
    processed?.validation?.taxRows?.map((row) => ({
      atcCode: row.atcCode,
      taxType: row.taxType,
      status: row.status,
    })),
    [
      { atcCode: "WC157", taxType: "WE", status: "valid" },
      { atcCode: "WV020", taxType: "WV", status: "valid" },
    ],
  );
  assert.equal(
    processed?.validation?.checks.find(
      (check) => check.code === "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
    )?.passed,
    true,
  );
});

test("inactive ATC rows are ignored while raw extraction remains auditable", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC158: 0.01, WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const certificate = state.certificates![0]!;
  const sourceRow = certificate.effective.taxRows[0]!;
  const inactiveRow = {
    ...sourceRow,
    lineNumber: 1,
    atcCode: "WC158",
    description: "PAYMENT OF GOODS",
    monthlyAmounts: {
      first: null,
      second: null,
      third: null,
    },
    taxBase: null,
    taxRate: "0.010000",
    taxWithheld: null,
  };
  const activeRow = {
    ...sourceRow,
    lineNumber: 2,
    atcCode: "WC160",
    description: "PAYMENT OF SERVICES",
  };
  const extractedRows = [inactiveRow, activeRow];
  certificate.effective.taxRows = structuredClone(extractedRows);
  certificate.effective.primaryAtcCode = "WC158";
  certificate.extracted.taxRows = structuredClone(extractedRows);
  state.extractionResult!.certificates[0]!.taxRows =
    structuredClone(extractedRows);

  const result = await node(state);
  const processed = result.certificates?.[0];

  assert.equal(processed?.status, "accepted");
  assert.deepEqual(
    processed?.effective.taxRows.map((row) => row.atcCode),
    ["WC160"],
  );
  assert.equal(processed?.effective.primaryAtcCode, "WC160");
  assert.deepEqual(
    processed?.extracted.taxRows.map((row) => row.atcCode),
    ["WC158", "WC160"],
  );
  assert.deepEqual(
    state.extractionResult.certificates[0]?.taxRows.map((row) => row.atcCode),
    ["WC158", "WC160"],
  );
  assert.equal(processed?.reasonCodes.includes("missing_tax_base"), false);
  assert.equal(processed?.reasonCodes.includes("missing_tax_withheld"), false);
});

test("partially populated ATC rows remain active and report missing amounts", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const row = state.certificates![0]!.effective.taxRows[0]!;
  row.taxBase = null;
  row.taxWithheld = null;

  const result = await node(state);
  const certificate = result.certificates?.[0];

  assert.equal(certificate?.effective.taxRows.length, 1);
  assert.ok(certificate?.reasonCodes.includes("missing_tax_base"));
  assert.ok(certificate?.reasonCodes.includes("missing_tax_withheld"));
});

test("explicit zero amounts keep an ATC row active", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const row = state.certificates![0]!.effective.taxRows[0]!;
  row.monthlyAmounts = {
    first: "0.00",
    second: null,
    third: null,
  };
  row.taxBase = "0.00";
  row.taxWithheld = "0.00";

  const result = await node(state);
  const certificate = result.certificates?.[0];

  assert.equal(certificate?.effective.taxRows.length, 1);
  assert.ok(certificate?.reasonCodes.includes("invalid_tax_base"));
  assert.ok(certificate?.reasonCodes.includes("invalid_tax_withheld"));
  assert.equal(certificate?.reasonCodes.includes("missing_tax_base"), false);
  assert.equal(
    certificate?.reasonCodes.includes("missing_tax_withheld"),
    false,
  );
});

test("a certificate with only inactive ATC rows reports missing tax rows", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC158: 0.01 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const certificate = state.certificates![0]!;
  const inactiveRow = {
    ...certificate.effective.taxRows[0]!,
    atcCode: "WC158",
    monthlyAmounts: {
      first: null,
      second: null,
      third: null,
    },
    taxBase: null,
    taxRate: "0.010000",
    taxWithheld: null,
  };
  certificate.effective.taxRows = [inactiveRow];
  certificate.effective.primaryAtcCode = "WC158";
  certificate.extracted.taxRows = [structuredClone(inactiveRow)];

  const result = await node(state);
  const processed = result.certificates?.[0];

  assert.deepEqual(processed?.effective.taxRows, []);
  assert.equal(processed?.effective.primaryAtcCode, null);
  assert.deepEqual(
    processed?.extracted.taxRows.map((row) => row.atcCode),
    ["WC158"],
  );
  assert.ok(processed?.reasonCodes.includes("missing_tax_rows"));
  assert.equal(processed?.reasonCodes.includes("missing_tax_base"), false);
  assert.equal(processed?.reasonCodes.includes("missing_tax_withheld"), false);
});

test("secondary WV020 still requires a government customer", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC157: 0.02, WV020: 0.05 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const firstRow = state.certificates![0]!.effective.taxRows[0]!;
  state.certificates![0]!.effective.taxRows = [
    { ...firstRow, atcCode: "WC157" },
    {
      ...firstRow,
      lineNumber: 2,
      atcCode: "WV020",
      taxWithheld: "5.00",
    },
  ];

  const result = await node(state);
  const certificate = result.certificates?.[0];

  assert.equal(certificate?.effective.primaryAtcCode, "WC157");
  assert.equal(certificate?.status, "error");
  assert.ok(
    certificate?.reasonCodes.includes("government_customer_required_for_wv020"),
  );
  assert.equal(
    certificate?.validation?.checks.find(
      (check) => check.code === "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
    )?.passed,
    false,
  );
});

test("secondary missing, unknown, and variance ATCs fail their own row validation", async () => {
  const cases = [
    {
      atcCode: null,
      taxBase: "100.00",
      taxWithheld: "2.00",
      reason: "missing_atc_code",
    },
    {
      atcCode: "WC999",
      taxBase: "100.00",
      taxWithheld: "2.00",
      reason: "unknown_atc_code",
    },
    {
      atcCode: "WC157",
      taxBase: "80.00",
      taxWithheld: "2.00",
      reason: "variance_exceeded",
    },
  ] as const;

  for (const validationCase of cases) {
    const node = createProcessCertificatesNode({
      db: createDb(),
      getAtcRules: async () => toAtcRules({ WC160: 0.02, WC157: 0.02 }),
      varianceThresholdPhp: 1,
      logger,
    });
    const state = createState();
    const firstRow = state.certificates![0]!.effective.taxRows[0]!;
    state.certificates![0]!.effective.taxRows = [
      firstRow,
      {
        ...firstRow,
        lineNumber: 2,
        atcCode: validationCase.atcCode,
        taxBase: validationCase.taxBase,
        taxWithheld: validationCase.taxWithheld,
      },
    ];

    const result = await node(state);
    const certificate = result.certificates?.[0];
    const secondRow = certificate?.validation?.taxRows?.[1];

    assert.equal(certificate?.status, "error");
    assert.equal(secondRow?.lineNumber, 2);
    assert.equal(secondRow?.status, "invalid");
    assert.ok(secondRow?.reasons.includes(validationCase.reason));
  }
});

test("nonstandard ATC shapes defer validity to the reference lookup", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificates![0]!.effective.taxRows[0]!.atcCode = "WC 1607";

  const result = await node(state);
  const certificate = result.certificates?.[0];
  const taxRow = certificate?.validation?.taxRows?.[0];

  assert.equal(certificate?.effective.taxRows[0]?.atcCode, "WC1607");
  assert.equal(taxRow?.atcCode, "WC1607");
  assert.equal(
    taxRow?.checks.find((check) => check.code === "ATC_CODE_PRESENT")?.passed,
    true,
  );
  assert.equal(
    taxRow?.checks.find((check) => check.code === "ATC_RATE_FOUND")?.passed,
    false,
  );
  assert.ok(taxRow?.reasons.includes("unknown_atc_code"));
  assert.equal(taxRow?.reasons.includes("missing_atc_code"), false);
});

test("duplicate WE codes remain separate and all valid WE rows contribute to totals", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC157: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  const firstRow = state.certificates![0]!.effective.taxRows[0]!;
  state.certificates![0]!.effective.taxRows = [
    {
      ...firstRow,
      lineNumber: 2,
      atcCode: "WC157",
      taxBase: "200.00",
      taxWithheld: "4.00",
    },
    {
      ...firstRow,
      lineNumber: 1,
      atcCode: "WC157",
      taxBase: "100.00",
      taxWithheld: "2.00",
    },
  ];

  const result = await node(state);
  const certificate = result.certificates?.[0];

  assert.equal(certificate?.status, "accepted");
  assert.equal(certificate?.effective.taxRows.length, 2);
  assert.deepEqual(
    certificate?.effective.taxRows.map((row) => row.lineNumber),
    [1, 2],
  );
  assert.deepEqual(certificate?.reconciliationTotals, {
    taxBase: "300.00",
    taxWithheld: "6.00",
  });
});

test("WV-only and incomplete-WE certificates do not produce reconciliation totals", async () => {
  const wvNode = createProcessCertificatesNode({
    db: createDb({
      masterlistMatches: [{ ...masterlistMatch, isGovernment: true }],
    }),
    getAtcRules: async () => toAtcRules({ WV020: 0.05 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const wvState = createState();
  const wvRow = wvState.certificates![0]!.effective.taxRows[0]!;
  Object.assign(wvRow, {
    atcCode: "WV020",
    taxBase: "100.00",
    taxWithheld: "5.00",
  });

  const wvResult = await wvNode(wvState);
  assert.equal(wvResult.certificates?.[0]?.status, "accepted");
  assert.equal(wvResult.certificates?.[0]?.effective.primaryAtcCode, "WV020");
  assert.deepEqual(wvResult.certificates?.[0]?.reconciliationTotals, {
    taxBase: null,
    taxWithheld: null,
  });

  const incompleteNode = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const incompleteState = createState();
  incompleteState.certificates![0]!.effective.taxRows[0]!.taxWithheld = null;

  const incompleteResult = await incompleteNode(incompleteState);
  assert.equal(incompleteResult.certificates?.[0]?.status, "error");
  assert.deepEqual(incompleteResult.certificates?.[0]?.reconciliationTotals, {
    taxBase: null,
    taxWithheld: null,
  });
});

test("selected entity name match does not fall back for a mismatched payee TIN", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.event.selectedEntity = {
    id: 1,
    shortName: "DEMO",
    companyName: "THE DEMO PAYEE INCORPORATED",
    tin: "9999999990000",
  };
  state.certificates![0]!.effective.payee.name = "Demo, Payee";

  const result = await node(state);
  const certificate = result.certificates?.[0];
  const entityChecks = certificate?.validation?.checks.filter((check) =>
    check.code.startsWith("ENTITY_PAYEE_"),
  );

  assert.equal(certificate?.status, "error");
  assert.equal(certificate?.payeeShortName, null);
  assert.deepEqual(
    entityChecks?.map((check) => [check.code, check.passed]),
    [
      ["ENTITY_PAYEE_TIN_MATCH", false],
      ["ENTITY_PAYEE_NAME_MATCH", true],
    ],
  );
});

test("selected entity name mismatch fails even when payee TIN matches", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.event.selectedEntity = {
    id: 1,
    shortName: "DEMO",
    companyName: "DEMO PAYEE",
    tin: "0050316630000",
  };
  state.certificates![0]!.effective.payee.name = "DEMO PAYEE HOLDINGS";

  const result = await node(state);

  assert.equal(result.certificates?.[0]?.status, "error");
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes(
      "entity_payee_name_mismatch",
    ),
  );
  assert.equal(result.certificates?.[0]?.payeeShortName, null);
});

test("selected entity displays separate failures when payee TIN and name both mismatch", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.event.selectedEntity = {
    id: 1,
    shortName: "OTHER",
    companyName: "OTHER COMPANY",
    tin: "9999999990000",
  };

  const result = await node(state);
  const failedEntityChecks = result.certificates?.[0]?.validation?.checks
    .filter((check) => !check.passed)
    .filter((check) => check.code.startsWith("ENTITY_PAYEE_"));

  assert.deepEqual(
    failedEntityChecks?.map((check) => check.code),
    ["ENTITY_PAYEE_TIN_MATCH", "ENTITY_PAYEE_NAME_MATCH"],
  );
});

test("validation errors take precedence over duplicate detection", async () => {
  const queryCounts = {
    sourceDuplicate: 0,
    certificateDuplicate: 0,
    masterlist: 0,
  };
  const node = createProcessCertificatesNode({
    db: createDb({
      sourceDuplicate: true,
      certificateDuplicate: true,
      queryCounts,
    }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificates![0]!.effective.signer.signature.present = false;

  const result = await node(state);

  assert.equal(result.documentStatus, "error");
  assert.equal(result.decision?.terminalStatus, "Error");
  assert.equal(result.certificates?.[0]?.status, "error");
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes("missing_signature"),
  );
  assert.equal(
    result.certificates?.[0]?.reasonCodes.includes("duplicate_source_document"),
    false,
  );
  assert.equal(queryCounts.sourceDuplicate, 0);
  assert.equal(queryCounts.certificateDuplicate, 0);
});

type ValidationCase = {
  name: string;
  code: string;
  reason: string;
  message: string;
  mutate: (state: WorkflowState) => void;
  dbOptions?: DbOptions;
  rates?: Record<string, number>;
};

const validationCases: ValidationCase[] = [
  {
    name: "missing payee name",
    code: "PAYEE_NAME_PRESENT",
    reason: "missing_payee_name",
    message: "Payee name is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.payee.name = null;
    },
  },
  {
    name: "missing payor name",
    code: "PAYOR_NAME_PRESENT",
    reason: "missing_payor_name",
    message: "Payor name is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.payor.name = null;
    },
  },
  {
    name: "placeholder payor name",
    code: "PAYOR_NAME_PRESENT",
    reason: "missing_payor_name",
    message: "Payor name is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.payor.name = "NOT PROVIDED";
    },
  },
  {
    name: "missing payee TIN",
    code: "PAYEE_TIN_PRESENT",
    reason: "missing_payee_tin",
    message: "Payee TIN is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.payee.tin = null;
    },
  },
  {
    name: "missing payor TIN",
    code: "PAYOR_TIN_PRESENT",
    reason: "missing_payor_tin",
    message: "Payor TIN is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.payor.tin = null;
    },
  },
  {
    name: "missing ATC code",
    code: "ATC_CODE_PRESENT",
    reason: "missing_atc_code",
    message: "Tax row 1 ATC code is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.atcCode = null;
    },
  },
  {
    name: "missing period covered",
    code: "PERIOD_COVERED_PRESENT",
    reason: "missing_period_covered",
    message: "Period covered is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.period.end = null;
    },
  },
  {
    name: "missing tax rows",
    code: "TAX_ROWS_PRESENT",
    reason: "missing_tax_rows",
    message: "Tax rows are missing",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows = [];
    },
  },
  {
    name: "missing tax base",
    code: "TAX_BASE_PRESENT",
    reason: "missing_tax_base",
    message: "Tax row 1 tax base is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.taxBase = null;
    },
  },
  {
    name: "missing tax withheld",
    code: "TAX_WITHHELD_PRESENT",
    reason: "missing_tax_withheld",
    message: "Tax row 1 tax withheld is missing",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.taxWithheld = null;
    },
  },
  {
    name: "missing selected entity",
    code: "ENTITY_PAYEE_TIN_MATCH",
    reason: "entity_payee_tin_mismatch",
    message: "Selected upload entity is missing for payee TIN validation",
    mutate: (state) => {
      state.event.selectedEntity = undefined;
    },
  },
  {
    name: "invalid selected entity",
    code: "ENTITY_PAYEE_TIN_MATCH",
    reason: "entity_payee_tin_mismatch",
    message: "Selected entity TIN must contain at least 9 digits",
    mutate: (state) => {
      state.event.selectedEntity = {
        id: 1,
        shortName: "AESI",
        companyName: " ",
        tin: "123",
      };
    },
  },
  {
    name: "selected entity mismatch",
    code: "ENTITY_PAYEE_TIN_MATCH",
    reason: "entity_payee_tin_mismatch",
    message:
      'Payee TIN prefix "005031663" does not match selected entity TIN prefix "999999999"',
    mutate: (state) => {
      state.event.selectedEntity = {
        id: 1,
        shortName: "OTHER",
        companyName: "OTHER COMPANY",
        tin: "9999999990000",
      };
    },
  },
  {
    name: "unknown ATC",
    code: "ATC_RATE_FOUND",
    reason: "unknown_atc_code",
    message: "ATC rate not configured: WC999",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.atcCode = "WC999";
    },
  },
  {
    name: "missing printed name",
    code: "PRINTED_NAME_PRESENT",
    reason: "missing_printed_name",
    message: "Payor printed name not present",
    mutate: (state) => {
      state.certificates![0]!.effective.signer.printedName = null;
    },
  },
  {
    name: "missing signature",
    code: "SIGNATURE_PRESENT",
    reason: "missing_signature",
    message: "Signature not present",
    mutate: (state) => {
      state.certificates![0]!.effective.signer.signature.present = false;
    },
  },
  {
    name: "invalid tax base",
    code: "TAX_BASE_VALID",
    reason: "invalid_tax_base",
    message: "Tax row 1 tax base is invalid or non-positive",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.taxBase = "0";
    },
  },
  {
    name: "invalid tax withheld",
    code: "TAX_WITHHELD_VALID",
    reason: "invalid_tax_withheld",
    message: "Tax row 1 tax withheld is invalid or non-positive",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.taxWithheld = "0";
    },
  },
  {
    name: "variance exceeded",
    code: "TAX_BASE_VARIANCE",
    reason: "variance_exceeded",
    message: "Tax row 1 variance 10 exceeds threshold 1",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.taxBase = "90";
    },
  },
  {
    name: "missing masterlist lookup input",
    code: "MASTERLIST_PAYOR_TIN_MATCH",
    reason: "payor_tin_not_found_in_masterlist",
    message:
      "Payor TIN must contain at least 9 digits for masterlist validation",
    mutate: (state) => {
      state.certificates![0]!.effective.payor.tin = "123";
      state.certificates![0]!.effective.payor.name = " ";
    },
  },
  {
    name: "payor not found in masterlist",
    code: "MASTERLIST_PAYOR_TIN_MATCH",
    reason: "payor_tin_not_found_in_masterlist",
    message: 'Payor TIN prefix "000202524" was not found in the masterlist',
    mutate: () => undefined,
    dbOptions: { masterlistMatches: [] },
  },
  {
    name: "masterlist lookup failure",
    code: "MASTERLIST_PAYOR_TIN_MATCH",
    reason: "masterlist_lookup_failed",
    message: "Masterlist payor TIN lookup failed: database unavailable",
    mutate: () => undefined,
    dbOptions: { masterlistError: new Error("database unavailable") },
  },
  {
    name: "WV020 non-government customer",
    code: "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
    reason: "government_customer_required_for_wv020",
    message: "ATC WV020 is only valid for government customers.",
    mutate: (state) => {
      state.certificates![0]!.effective.taxRows[0]!.atcCode = "WV020";
    },
    rates: { WC160: 0.02, WV020: 0.01 },
  },
];

for (const validationCase of validationCases) {
  test(`restores the previous validation message for ${validationCase.name}`, async () => {
    const node = createProcessCertificatesNode({
      db: createDb(validationCase.dbOptions),
      getAtcRules: async () =>
        toAtcRules(validationCase.rates ?? { WC160: 0.02 }),
      varianceThresholdPhp: 1,
      logger,
    });
    const state = createState();
    validationCase.mutate(state);

    const result = await node(state);
    const certificate = result.certificates?.[0];
    const check = certificate?.validation?.checks.find(
      (candidate) => candidate.code === validationCase.code,
    );

    assert.equal(certificate?.status, "error");
    assert.ok(certificate?.reasonCodes.includes(validationCase.reason));
    assert.deepEqual(check, {
      code: validationCase.code,
      passed: false,
      message: validationCase.message,
    });
  });
}

test("preserves positive messages for checks that pass", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());
  const signatureCheck = result.certificates?.[0]?.validation?.checks.find(
    (check) => check.code === "SIGNATURE_PRESENT",
  );

  assert.deepEqual(signatureCheck, {
    code: "SIGNATURE_PRESENT",
    passed: true,
    message: "Signature is present.",
  });
  assert.equal(result.certificates?.[0]?.status, "accepted");
});

test("preserves current source-document duplicate behavior and reason code", async () => {
  const node = createProcessCertificatesNode({
    db: createDb({ sourceDuplicate: true }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());

  assert.equal(result.certificates?.[0]?.status, "duplicate");
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes("duplicate_source_document"),
  );
  assert.equal(
    result.certificates?.[0]?.reasonCodes.includes("duplicate_certificate"),
    false,
  );
  assert.equal(result.certificates?.[0]?.duplicateOfCertificateId, undefined);
});

test("preserves current certificate duplicate behavior and reason code", async () => {
  const node = createProcessCertificatesNode({
    db: createDb({ certificateDuplicate: true }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());

  assert.equal(result.certificates?.[0]?.status, "duplicate");
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes("duplicate_certificate"),
  );
  assert.equal(
    result.certificates?.[0]?.reasonCodes.includes("duplicate_source_document"),
    false,
  );
  assert.equal(result.certificates?.[0]?.duplicateOfCertificateId, 20);
});

test("both duplicate signals are retained with deterministic certificate linkage", async () => {
  const duplicateOrderBy: DbOptions["duplicateOrderBy"] = {};
  const node = createProcessCertificatesNode({
    db: createDb({
      sourceDuplicate: true,
      certificateDuplicate: true,
      duplicateOrderBy,
    }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  const result = await node(createState());
  const certificate = result.certificates?.[0];
  const dialect = new PgDialect();

  assert.deepEqual(
    certificate?.reasonCodes.filter((reason) =>
      reason.startsWith("duplicate_"),
    ),
    ["duplicate_source_document", "duplicate_certificate"],
  );
  assert.equal(certificate?.duplicateOfCertificateId, 20);
  assert.equal(certificate?.status, "duplicate");
  assert.equal(result.documentStatus, "duplicate");
  assert.equal(result.decision?.terminalStatus, "Duplicate");
  assert.deepEqual(
    duplicateOrderBy.source?.map(
      (expression) => dialect.sqlToQuery(expression).sql,
    ),
    ['"document_results"."created_at" asc', '"document_results"."id" asc'],
  );
  assert.deepEqual(
    duplicateOrderBy.certificate?.map(
      (expression) => dialect.sqlToQuery(expression).sql,
    ),
    [
      '"extracted_certificates"."created_at" asc',
      '"extracted_certificates"."id" asc',
    ],
  );
});

test("normal duplicate signals exclude the current upload and qualify only accepted prior results", async () => {
  const duplicateWhere: DbOptions["duplicateWhere"] = {};
  const node = createProcessCertificatesNode({
    db: createDb({ duplicateWhere }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });

  await node(createState());

  const dialect = new PgDialect();
  assert.ok(duplicateWhere.source);
  assert.ok(duplicateWhere.certificate);
  const sourceQuery = dialect.sqlToQuery(duplicateWhere.source);
  const certificateQuery = dialect.sqlToQuery(duplicateWhere.certificate);
  assert.equal(
    sourceQuery.params.filter((value) => value === "accepted").length,
    1,
  );
  assert.equal(
    certificateQuery.params.filter((value) => value === "accepted").length,
    2,
  );
  assert.equal(
    sourceQuery.params.includes("22222222-2222-4222-8222-222222222222"),
    true,
  );
  assert.equal(
    certificateQuery.params.includes("22222222-2222-4222-8222-222222222222"),
    true,
  );
  assert.match(sourceQuery.sql, /<>/u);
  assert.match(certificateQuery.sql, /<>/u);
  assert.equal(sourceQuery.params.includes("error"), false);
  assert.equal(sourceQuery.params.includes("duplicate"), false);
  assert.equal(certificateQuery.params.includes("error"), false);
  assert.equal(certificateQuery.params.includes("duplicate"), false);
});

test("multi-certificate errors run validation and masterlist resolution without dedupe", async () => {
  const queryCounts = {
    sourceDuplicate: 0,
    certificateDuplicate: 0,
    masterlist: 0,
  };
  const node = createProcessCertificatesNode({
    db: createDb({
      sourceDuplicate: true,
      certificateDuplicate: true,
      queryCounts,
    }),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificateSelection = {
    strategy: "lowest_page_then_response_order",
    detectedCount: 2,
    selectedResponseOrdinal: 2,
    selectedLowestPageNumber: 1,
    discardedCertificates: [{ responseOrdinal: 1, pageNumbers: [2] }],
  };
  state.certificates![0]!.status = "error";
  state.certificates![0]!.reasonCodes = ["multiple_certificates_detected"];
  state.reasonCodes = ["multiple_certificates_detected"];

  const result = await node(state);
  const certificate = result.certificates?.[0];

  assert.equal(queryCounts.sourceDuplicate, 0);
  assert.equal(queryCounts.certificateDuplicate, 0);
  assert.ok(queryCounts.masterlist > 0);
  assert.equal(certificate?.masterlistLookup?.status, "matched");
  assert.ok(certificate?.validation?.checks.length);
  assert.equal(certificate?.validation?.status, "invalid");
  assert.equal(certificate?.status, "error");
  assert.equal(certificate?.duplicateOfCertificateId, undefined);
  assert.deepEqual(
    certificate?.reasonCodes.filter(
      (reason) => reason === "multiple_certificates_detected",
    ),
    ["multiple_certificates_detected"],
  );
  assert.equal(result.documentStatus, "error");
  assert.equal(result.decision?.terminalStatus, "Error");
});

test("multi-certificate structural errors preserve normal validation failures", async () => {
  const node = createProcessCertificatesNode({
    db: createDb(),
    getAtcRules: async () => toAtcRules({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger,
  });
  const state = createState();
  state.certificateSelection = {
    strategy: "lowest_page_then_response_order",
    detectedCount: 2,
    selectedResponseOrdinal: 1,
    selectedLowestPageNumber: 1,
    discardedCertificates: [{ responseOrdinal: 2, pageNumbers: [2] }],
  };
  state.certificates![0]!.effective.signer.signature.present = false;
  state.certificates![0]!.status = "error";
  state.certificates![0]!.reasonCodes = ["multiple_certificates_detected"];

  const result = await node(state);

  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes(
      "multiple_certificates_detected",
    ),
  );
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes("missing_signature"),
  );
});
