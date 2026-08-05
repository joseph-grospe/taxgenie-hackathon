import assert from "node:assert/strict";
import test from "node:test";

import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client.ts";
import {
  certificateProcessedNumberCounters,
  certificateTaxRows,
  documentExtractionAttempts,
  documentResults,
  extractedCertificates,
  intakeFiles,
  resultArtifacts,
} from "../../db/schema.ts";
import type { WorkflowState } from "../types.ts";
import {
  buildIntakeFileCertificateMetadata,
  createPersistResultsNode,
  derivePrimaryAtcTotals,
} from "./persistResults.ts";

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function createAcceptedState(): WorkflowState {
  const certificate = {
    certificateKey: "certificate-1",
    pageNumbers: [1, 2],
    period: {
      start: "2026-04-01",
      end: "2026-06-30",
      monthOfQuarter: "first" as const,
    },
    payee: {
      name: "THERMA VISAYAS, INC.",
      tin: "00503166300000",
      address: "CEBU CITY",
      zip: "6000",
    },
    payor: {
      name: "DAGUPAN ELECTRIC CORPORATION",
      tin: "0002025240000",
      address: "DAGUPAN CITY",
      zip: "2400",
    },
    taxRows: [
      {
        lineNumber: 1,
        pageNumber: 2,
        atcCode: "WC160",
        description: "Payment made by top 10,000 corporations",
        monthlyAmounts: {
          first: "116833.55",
          second: null,
          third: null,
        },
        taxBase: "116833.55",
        taxRate: "0.020000",
        taxWithheld: "2336.67",
      },
    ],
    primaryAtcCode: "WC160",
    totals: {
      taxBase: "116833.55",
      taxWithheld: "2336.67",
    },
    signer: {
      printedName: "LILIAN D. SARALDE",
      title: "Finance Manager",
      tin: "901327847000",
      companyName: null,
      signature: {
        present: true,
        confidence: 0.93,
        pageNumber: 2,
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
      modifiedTime: "2026-07-27T00:00:00.000Z",
      mimeType: "application/pdf",
      sizeBytes: 10,
      artifactUri: "s3://source-bucket/uploads/source.pdf",
      uploadedByUserId: "user-1",
      uploadedAt: "2026-07-27T00:00:00.000Z",
      receivedAt: "2026-07-27T00:00:00.000Z",
    },
    jobId: "job-1",
    extractionAttemptId: 501,
    source: {
      uri: "s3://source-bucket/uploads/source.pdf",
      bucket: "source-bucket",
      key: "uploads/source.pdf",
      mimeType: "application/pdf",
      contentType: "application/pdf",
      hash: "a".repeat(64),
    },
    extractionResult: {
      schemaVersion: 1,
      classification: {
        documentType: "BIR_2307",
        confidence: 0.99,
        pageCount: 2,
      },
      certificates: [certificate],
    },
    extractionMetadata: {
      provider: "gemini",
      requestedModel: "gemini-3-flash-preview",
      responseModel: "gemini-3-flash-preview-20260701",
      promptVersion: "bir2307-agentic-v1",
      schemaVersion: 1,
      thinkingLevel: "high",
      mediaResolution: "medium",
      startedAt: "2026-07-27T00:00:00.000Z",
      finishedAt: "2026-07-27T00:00:01.000Z",
      latencyMs: 1_000,
      attemptCount: 1,
      usage: {
        promptTokenCount: 100,
        outputTokenCount: 50,
        thoughtTokenCount: 25,
        totalTokenCount: 175,
      },
    },
    pageCount: 2,
    certificates: [
      {
        ordinal: 1,
        extracted: certificate,
        effective: certificate,
        status: "accepted",
        reasonCodes: [],
        validation: {
          status: "valid",
          reasons: [],
          checks: [],
        },
        payeeShortName: "TVI",
        payorShortName: "DECORP",
        fingerprint: "b".repeat(64),
        signatureFallback: {
          status: "detected",
          promoted: false,
          minimumConfidence: 0.86,
          providerSignaturePresent: true,
          payorSignerVerification: {
            status: "confirmed",
            source: "text_layout",
            pageNumber: 2,
            recoveredFields: ["printedName", "title", "tin"],
            latencyMs: 12,
          },
        },
        certificatePdfBase64: Buffer.from("certificate-pdf").toString("base64"),
      },
    ],
    documentStatus: "accepted",
    reasonCodes: [],
  };
}

function createStore() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const ignoredConflicts: Array<{
    table: unknown;
    target: unknown;
  }> = [];
  const updatedConflicts: Array<{
    table: unknown;
    config: Record<string, unknown>;
  }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const uploads: Array<Record<string, unknown>> = [];
  let transactionCount = 0;
  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return {
          returning: async () => {
            if (table === documentResults) return [{ id: 101 }];
            if (table === extractedCertificates) return [{ id: 202 }];
            return [];
          },
          onConflictDoUpdate: (config: Record<string, unknown>) => {
            updatedConflicts.push({ table, config });
            return {
              returning: async () =>
                table === documentResults ? [{ id: 101 }] : [{ value: 7 }],
            };
          },
          onConflictDoNothing: (config: { target: unknown }) => {
            ignoredConflicts.push({ table, target: config.target });
            return Promise.resolve();
          },
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        updates.push({ table, values });
        return {
          where: async () => undefined,
        };
      },
    }),
  };
  const db = {
    transaction: async <TResult>(
      callback: (transaction: typeof tx) => Promise<TResult>,
    ) => {
      transactionCount += 1;
      return callback(tx);
    },
  } as unknown as DbClient;
  const s3 = {
    send: async (command: { input: Record<string, unknown> }) => {
      uploads.push(command.input);
      return {};
    },
  } as unknown as S3Client;
  return {
    db,
    s3,
    inserts,
    ignoredConflicts,
    updatedConflicts,
    updates,
    uploads,
    get transactionCount() {
      return transactionCount;
    },
  };
}

test("persistence atomically writes envelope, child projection, tax rows, and certificate PDF", async () => {
  const store = createStore();
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => ({
      status: "skipped",
      rowCount: 0,
      runIds: [],
    }),
  });

  const state = createAcceptedState();
  state.ignoredBlankPageNumbers = [2];
  const result = await node(state);

  assert.equal(store.transactionCount, 1);
  assert.equal(result.documentResultId, 101);
  assert.equal(result.certificates?.[0]?.certificatePdfBase64, undefined);
  assert.match(result.certificates?.[0]?.artifactKey ?? "", /\/202\//u);
  assert.equal(store.uploads.length, 1);
  const attemptUpdate = store.updates.find(
    (entry) => entry.table === documentExtractionAttempts,
  )?.values as Record<string, unknown>;
  assert.equal(attemptUpdate.status, "succeeded");
  assert.equal(attemptUpdate.providerAttemptCount, 1);
  assert.equal(attemptUpdate.promptTokenCount, 100);
  assert.equal(attemptUpdate.outputTokenCount, 50);
  assert.equal(attemptUpdate.thoughtTokenCount, 25);
  assert.equal(attemptUpdate.totalTokenCount, 175);
  assert.equal(
    store.updates.some((entry) => entry.table === intakeFiles),
    true,
  );

  const documentInsert = store.inserts.find(
    (entry) => entry.table === documentResults,
  )?.values as Record<string, unknown>;
  assert.equal(documentInsert.status, "accepted");
  assert.equal(documentInsert.certificateCount, 1);
  assert.equal(documentInsert.sourceHash, "a".repeat(64));
  assert.equal(documentInsert.currentExtractionAttemptId, 501);
  assert.equal("attemptTelemetry" in documentInsert, false);
  const documentConflict = store.updatedConflicts.find(
    (entry) => entry.table === documentResults,
  );
  assert.ok(documentConflict);
  assert.equal(documentConflict.config.target, documentResults.uploadId);
  assert.ok(documentConflict.config.setWhere);

  const payload = documentInsert.payload as Record<string, unknown>;
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /ocrText|parsedText|document_annotation|sourceContentBase64|raw-extraction/u,
  );
  assert.match(serialized, /gemini-3-flash-preview/u);
  assert.match(serialized, /payorSignerVerification/iu);
  assert.match(serialized, /text_layout/u);
  assert.doesNotMatch(serialized, /cropImage|rawModelResponse/iu);
  assert.deepEqual(
    (payload.processing as Record<string, unknown>).ignoredBlankPageNumbers,
    [2],
  );

  const certificateInsert = store.inserts.find(
    (entry) => entry.table === extractedCertificates,
  )?.values as Record<string, unknown>;
  assert.equal(certificateInsert.documentResultId, 101);
  assert.equal(certificateInsert.primaryAtcCode, "WC160");
  assert.equal(certificateInsert.totalTaxWithheld, "2336.67");

  const rowsInsert = store.inserts.find(
    (entry) => entry.table === certificateTaxRows,
  )?.values as Array<Record<string, unknown>>;
  assert.equal(rowsInsert.length, 1);
  assert.equal(rowsInsert[0]?.certificateId, 202);

  const artifacts = store.inserts
    .filter((entry) => entry.table === resultArtifacts)
    .map((entry) => entry.values as Record<string, unknown>);
  assert.deepEqual(
    artifacts.map((artifact) => artifact.role),
    ["source_pdf", "certificate_pdf"],
  );
  assert.equal(
    store.inserts.some(
      (entry) => entry.table === certificateProcessedNumberCounters,
    ),
    true,
  );
});

test("persistence keeps inactive ATC rows in the raw payload only", async () => {
  const store = createStore();
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => ({
      status: "skipped",
      rowCount: 0,
      runIds: [],
    }),
  });
  const state = createAcceptedState();
  const certificate = state.certificates![0]!;
  const activeRow = {
    ...structuredClone(certificate.effective.taxRows[0]!),
    lineNumber: 2,
  };
  const inactiveRow = {
    ...structuredClone(activeRow),
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
  certificate.extracted = {
    ...certificate.extracted,
    taxRows: [inactiveRow, activeRow],
  };
  certificate.effective = {
    ...certificate.effective,
    taxRows: [activeRow],
  };
  state.extractionResult!.certificates[0] = {
    ...state.extractionResult!.certificates[0]!,
    taxRows: [structuredClone(inactiveRow), structuredClone(activeRow)],
  };

  await node(state);

  const rowsInsert = store.inserts.find(
    (entry) => entry.table === certificateTaxRows,
  )?.values as Array<Record<string, unknown>>;
  assert.deepEqual(
    rowsInsert.map((row) => ({
      lineNumber: row.lineNumber,
      atcCode: row.atcCode,
    })),
    [{ lineNumber: 2, atcCode: "WC160" }],
  );

  const documentInsert = store.inserts.find(
    (entry) => entry.table === documentResults,
  )?.values as Record<string, unknown>;
  const payload = documentInsert.payload as {
    extraction: {
      certificates: Array<{
        taxRows: Array<{ atcCode: string | null }>;
      }>;
    };
  };
  assert.deepEqual(
    payload.extraction.certificates[0]?.taxRows.map((row) => row.atcCode),
    ["WC158", "WC160"],
  );
});

test("persistence stores both ATCs and reconciles only derived WE totals", async () => {
  const store = createStore();
  let reconciledNormalized: Record<string, unknown> | undefined;
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async (_db, input) => {
      reconciledNormalized = input.normalized;
      return {
        status: "skipped",
        rowCount: 0,
        runIds: [],
      };
    },
  });
  const state = createAcceptedState();
  const certificate = state.certificates![0]!;
  certificate.effective.taxRows = [
    {
      ...certificate.effective.taxRows[0]!,
      atcCode: "WC157",
      taxBase: "28030.86",
      taxRate: "0.02",
      taxWithheld: "560.62",
    },
    {
      ...certificate.effective.taxRows[0]!,
      lineNumber: 2,
      atcCode: "WV020",
      description: "5% VAT Withholding on Purchase of Services",
      taxBase: "28030.86",
      taxRate: "0.05",
      taxWithheld: "1401.54",
    },
  ];
  certificate.effective.primaryAtcCode = "WC157";
  certificate.effective.totals = {
    taxBase: "56061.72",
    taxWithheld: "1962.16",
  };
  certificate.reconciliationTotals = {
    taxBase: "28030.86",
    taxWithheld: "560.62",
  };

  await node(state);

  const certificateInsert = store.inserts.find(
    (entry) => entry.table === extractedCertificates,
  )?.values as Record<string, unknown>;
  assert.equal(certificateInsert.primaryAtcCode, "WC157");
  assert.equal(certificateInsert.totalTaxBase, "28030.86");
  assert.equal(certificateInsert.totalTaxWithheld, "560.62");

  const rowsInsert = store.inserts.find(
    (entry) => entry.table === certificateTaxRows,
  )?.values as Array<Record<string, unknown>>;
  assert.deepEqual(
    rowsInsert.map((row) => ({
      atcCode: row.atcCode,
      taxBase: row.taxBase,
      taxRate: row.taxRate,
      taxWithheld: row.taxWithheld,
    })),
    [
      {
        atcCode: "WC157",
        taxBase: "28030.86",
        taxRate: "0.02",
        taxWithheld: "560.62",
      },
      {
        atcCode: "WV020",
        taxBase: "28030.86",
        taxRate: "0.05",
        taxWithheld: "1401.54",
      },
    ],
  );
  assert.deepEqual(reconciledNormalized, {
    taxBase: "28030.86",
    taxWithheld: "560.62",
  });
});

test("variance errors persist primary ATC totals without becoming reconcilable", async () => {
  const store = createStore();
  let reconciliationCalls = 0;
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => {
      reconciliationCalls += 1;
      return {
        status: "skipped",
        rowCount: 0,
        runIds: [],
      };
    },
  });
  const state = createAcceptedState();
  const certificate = state.certificates![0]!;
  certificate.status = "error";
  certificate.reasonCodes = ["variance_exceeded"];
  certificate.validation = {
    status: "invalid",
    reasons: ["variance_exceeded"],
    checks: [],
  };
  certificate.reconciliationTotals = undefined;
  certificate.effective.primaryAtcCode = "WC160";
  certificate.effective.taxRows[0]!.taxBase = "611504.51";
  certificate.effective.taxRows[0]!.taxWithheld = "10919.72";
  certificate.effective.totals = {
    taxBase: "611504.51",
    taxWithheld: "10919.72",
  };
  state.documentStatus = "error";
  state.reasonCodes = ["variance_exceeded"];

  await node(state);

  const certificateInsert = store.inserts.find(
    (entry) => entry.table === extractedCertificates,
  )?.values as Record<string, unknown>;
  assert.equal(certificateInsert.totalTaxBase, "611504.51");
  assert.equal(certificateInsert.totalTaxWithheld, "10919.72");
  assert.equal(reconciliationCalls, 0);
});

test("WV-only errors expose their primary ATC totals without reconciliation", async () => {
  const store = createStore();
  let reconciliationCalls = 0;
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => {
      reconciliationCalls += 1;
      return {
        status: "skipped",
        rowCount: 0,
        runIds: [],
      };
    },
  });
  const state = createAcceptedState();
  const certificate = state.certificates![0]!;
  certificate.status = "error";
  certificate.reasonCodes = ["unsupported_tax_type"];
  certificate.validation = {
    status: "invalid",
    reasons: ["unsupported_tax_type"],
    checks: [],
  };
  certificate.reconciliationTotals = undefined;
  certificate.effective.primaryAtcCode = "WV020";
  certificate.effective.taxRows = [
    {
      ...certificate.effective.taxRows[0]!,
      atcCode: "WV020",
      taxBase: "28030.86",
      taxRate: "0.05",
      taxWithheld: "1401.54",
    },
  ];
  state.documentStatus = "error";
  state.reasonCodes = ["unsupported_tax_type"];

  await node(state);

  const certificateInsert = store.inserts.find(
    (entry) => entry.table === extractedCertificates,
  )?.values as Record<string, unknown>;
  assert.equal(certificateInsert.totalTaxBase, "28030.86");
  assert.equal(certificateInsert.totalTaxWithheld, "1401.54");
  assert.equal(reconciliationCalls, 0);
});

test("primary ATC totals sum matching rows and preserve incomplete fields as null", () => {
  const state = createAcceptedState();
  const certificate = state.certificates![0]!;
  certificate.effective.taxRows = [
    {
      ...certificate.effective.taxRows[0]!,
      taxBase: "100.10",
      taxWithheld: "2.00",
    },
    {
      ...certificate.effective.taxRows[0]!,
      lineNumber: 2,
      atcCode: "wc-160",
      taxBase: "200.20",
      taxWithheld: "4.00",
    },
    {
      ...certificate.effective.taxRows[0]!,
      lineNumber: 3,
      atcCode: "WV020",
      taxBase: "999.00",
      taxWithheld: "49.95",
    },
  ];

  assert.deepEqual(derivePrimaryAtcTotals(certificate), {
    taxBase: "300.30",
    taxWithheld: "6.00",
  });

  certificate.effective.taxRows[1]!.taxWithheld = null;
  assert.deepEqual(derivePrimaryAtcTotals(certificate), {
    taxBase: "300.30",
    taxWithheld: null,
  });
});

test("multi-certificate errors persist one projection and tax rows without downstream artifacts", async () => {
  const store = createStore();
  let reconciliationCalls = 0;
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => {
      reconciliationCalls += 1;
      return {
        status: "skipped",
        rowCount: 0,
        runIds: [],
      };
    },
  });
  const state = createAcceptedState();
  state.certificateSelection = {
    strategy: "lowest_page_then_response_order",
    detectedCount: 3,
    selectedResponseOrdinal: 2,
    selectedLowestPageNumber: 1,
    discardedCertificates: [
      { responseOrdinal: 1, pageNumbers: [2] },
      { responseOrdinal: 3, pageNumbers: [3] },
    ],
  };
  state.documentStatus = "error";
  state.reasonCodes = ["multiple_certificates_detected"];
  state.certificates![0]!.status = "error";
  state.certificates![0]!.reasonCodes = ["multiple_certificates_detected"];
  state.certificates![0]!.validation = {
    status: "invalid",
    reasons: ["multiple_certificates_detected"],
    checks: [],
  };

  const result = await node(state);

  const documentInsert = store.inserts.find(
    (entry) => entry.table === documentResults,
  )?.values as Record<string, unknown>;
  assert.equal(documentInsert.status, "error");
  assert.equal(documentInsert.certificateCount, 1);
  assert.deepEqual(
    (
      (documentInsert.payload as Record<string, unknown>).processing as Record<
        string,
        unknown
      >
    ).certificateSelection,
    state.certificateSelection,
  );

  const certificateWrites = store.inserts.filter(
    (entry) => entry.table === extractedCertificates,
  );
  assert.equal(certificateWrites.length, 1);
  assert.equal(
    (certificateWrites[0]?.values as Record<string, unknown>).status,
    "error",
  );
  assert.equal(
    store.inserts.some((entry) => entry.table === certificateTaxRows),
    true,
  );
  assert.deepEqual(
    store.inserts
      .filter((entry) => entry.table === resultArtifacts)
      .map((entry) => (entry.values as Record<string, unknown>).role),
    ["source_pdf"],
  );
  assert.equal(
    store.inserts.some(
      (entry) => entry.table === certificateProcessedNumberCounters,
    ),
    false,
  );
  assert.equal(store.uploads.length, 0);
  assert.equal(reconciliationCalls, 0);
  assert.equal(result.certificates?.[0]?.artifactKey, undefined);
  assert.equal(result.decision?.terminalStatus, "Error");
});

test("duplicate results persist projections and tax rows without downstream artifacts", async () => {
  const store = createStore();
  let reconciliationCalls = 0;
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => {
      reconciliationCalls += 1;
      return {
        status: "skipped",
        rowCount: 0,
        runIds: [],
      };
    },
  });
  const state = createAcceptedState();
  state.documentStatus = "duplicate";
  state.reasonCodes = ["duplicate_source_document", "duplicate_certificate"];
  state.certificates![0]!.status = "duplicate";
  state.certificates![0]!.reasonCodes = [
    "duplicate_source_document",
    "duplicate_certificate",
  ];
  state.certificates![0]!.duplicateOfCertificateId = 77;

  const result = await node(state);

  const documentInsert = store.inserts.find(
    (entry) => entry.table === documentResults,
  )?.values as Record<string, unknown>;
  assert.equal(documentInsert.status, "duplicate");
  assert.deepEqual(documentInsert.reasonCodes, [
    "duplicate_source_document",
    "duplicate_certificate",
  ]);

  const certificateInsert = store.inserts.find(
    (entry) => entry.table === extractedCertificates,
  )?.values as Record<string, unknown>;
  assert.equal(certificateInsert.status, "duplicate");
  assert.deepEqual(certificateInsert.reasonCodes, [
    "duplicate_source_document",
    "duplicate_certificate",
  ]);
  assert.equal(
    store.inserts.some((entry) => entry.table === certificateTaxRows),
    true,
  );
  assert.deepEqual(
    store.inserts
      .filter((entry) => entry.table === resultArtifacts)
      .map((entry) => (entry.values as Record<string, unknown>).role),
    ["source_pdf"],
  );
  assert.equal(
    store.inserts.some(
      (entry) => entry.table === certificateProcessedNumberCounters,
    ),
    false,
  );
  assert.equal(store.uploads.length, 0);
  assert.equal(reconciliationCalls, 0);
  assert.equal(result.certificates?.[0]?.artifactKey, undefined);
  assert.equal(result.decision?.terminalStatus, "Duplicate");
});

test("persistence keeps missing invalid fields null without inventing tax rows", async () => {
  const store = createStore();
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
  });
  const state = createAcceptedState();
  const certificate = state.certificates![0]!;
  certificate.effective.period = {
    start: null,
    end: null,
    monthOfQuarter: null,
  };
  certificate.effective.payor.name = null;
  certificate.effective.payor.tin = null;
  certificate.effective.taxRows = [];
  certificate.effective.primaryAtcCode = null;
  certificate.effective.totals = {
    taxBase: null,
    taxWithheld: null,
  };
  certificate.status = "error";
  certificate.reasonCodes = [
    "missing_payor_name",
    "missing_period_covered",
    "missing_tax_rows",
  ];
  certificate.validation = {
    status: "invalid",
    reasons: certificate.reasonCodes,
    checks: [],
  };
  state.documentStatus = "error";
  state.reasonCodes = certificate.reasonCodes;

  await node(state);

  const certificateInsert = store.inserts.find(
    (entry) => entry.table === extractedCertificates,
  )?.values as Record<string, unknown>;
  assert.equal(certificateInsert.periodStart, null);
  assert.equal(certificateInsert.periodEnd, null);
  assert.equal(certificateInsert.payorName, null);
  assert.equal(certificateInsert.payorTin, null);
  assert.equal(certificateInsert.primaryAtcCode, null);
  assert.equal(certificateInsert.totalTaxBase, null);
  assert.equal(certificateInsert.totalTaxWithheld, null);
  assert.equal(
    store.inserts.some((entry) => entry.table === certificateTaxRows),
    false,
  );
});

test("intake metadata uses the lowest certificate ordinal for unconventional filenames", () => {
  const state = createAcceptedState();
  state.event.originalFileName = "01.26 BUSECO.pdf";
  const firstCertificate = state.certificates?.[0];
  assert.ok(firstCertificate);
  firstCertificate.payorShortName = "BUSECO";
  firstCertificate.payeeShortName = "TVI";
  firstCertificate.effective.period = {
    start: "2026-01-01",
    end: "2026-03-31",
    monthOfQuarter: "first",
  };
  const secondCertificate = {
    ...firstCertificate,
    ordinal: 2,
    payorShortName: "OTHER",
    payeeShortName: "OTHER_PAYEE",
    effective: {
      ...firstCertificate.effective,
      period: {
        start: "2026-04-01",
        end: "2026-06-30",
        monthOfQuarter: "second" as const,
      },
    },
  };
  state.certificates = [secondCertificate, firstCertificate];

  assert.deepEqual(buildIntakeFileCertificateMetadata(state), {
    certificateDocumentType: "BIR2307",
    certificateIssuerShortName: "BUSECO",
    certificateIssuerShortNameNormalized: "BUSECO",
    certificateRecipientShortName: "TVI",
    certificateSettlementReferenceNumber: null,
    certificateBillingMonthMMYY: "0126",
    certificateDateUploaded: "20260727",
  });
});

test("source PDF persistence tolerates the bucket-key conflict caused by a manual retry", async () => {
  const store = createStore();
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => ({
      status: "skipped",
      rowCount: 0,
      runIds: [],
    }),
  });
  const state = createAcceptedState();
  state.event.revision = "manual-retry-2-15fcb6c2-9824-44f3-8c53-f59177b94f3a";

  const result = await node(state);

  assert.equal(result.documentResultId, 101);
  assert.equal(store.ignoredConflicts.length, 1);
  assert.equal(store.ignoredConflicts[0]?.table, resultArtifacts);
  assert.deepEqual(store.ignoredConflicts[0]?.target, [
    resultArtifacts.bucket,
    resultArtifacts.key,
  ]);
});

test("a failed retry and later success retain one stable document result id", async () => {
  const store = createStore();
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
    reconcileCertificate: async () => ({
      status: "skipped",
      rowCount: 0,
      runIds: [],
    }),
  });
  const failed = createAcceptedState();
  failed.extractionResult = undefined;
  failed.extractionMetadata = undefined;
  failed.certificates = [];
  failed.documentStatus = "error";
  failed.reasonCodes = ["gemini_http_503"];

  const first = await node(failed);
  const succeeded = createAcceptedState();
  succeeded.extractionAttemptId = 502;
  succeeded.jobId = "job-2";
  succeeded.event.eventId = "event-2";
  succeeded.event.revision =
    "manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const second = await node(succeeded);

  assert.equal(first.documentResultId, 101);
  assert.equal(second.documentResultId, 101);
  const resultWrites = store.inserts.filter(
    (entry) => entry.table === documentResults,
  );
  assert.equal(resultWrites.length, 2);
  assert.deepEqual(
    resultWrites.map(
      (entry) =>
        (entry.values as Record<string, unknown>).currentExtractionAttemptId,
    ),
    [501, 502],
  );
});

test("transport or schema failure stores a safe envelope with a null payload", async () => {
  const store = createStore();
  const node = createPersistResultsNode({
    db: store.db,
    s3: store.s3,
    bucket: "result-bucket",
    logger,
  });
  const state = createAcceptedState();
  state.extractionResult = undefined;
  state.extractionMetadata = undefined;
  state.certificates = [];
  state.documentStatus = "error";
  state.reasonCodes = ["gemini_transport_failed"];
  state.extractionFailureTelemetry = {
    attemptCount: 3,
    latencyMs: 12_000,
    safeErrorCode: "rate_limited",
  };

  await node(state);

  const documentInsert = store.inserts.find(
    (entry) => entry.table === documentResults,
  )?.values as Record<string, unknown>;
  assert.equal(documentInsert.status, "error");
  assert.equal(documentInsert.payload, null);
  assert.deepEqual(documentInsert.reasonCodes, ["gemini_transport_failed"]);
  assert.equal(documentInsert.currentExtractionAttemptId, 501);
  assert.equal("attemptTelemetry" in documentInsert, false);
  const attemptUpdate = store.updates.find(
    (entry) => entry.table === documentExtractionAttempts,
  )?.values as Record<string, unknown>;
  assert.equal(attemptUpdate.status, "failed");
  assert.equal(attemptUpdate.providerAttemptCount, 3);
  assert.equal(attemptUpdate.latencyMs, 12_000);
  assert.deepEqual(attemptUpdate.reasonCodes, ["gemini_transport_failed"]);
  assert.equal(
    store.inserts.some((entry) => entry.table === extractedCertificates),
    false,
  );
  assert.equal(store.uploads.length, 0);
  assert.equal(store.updates.length, 1);
  assert.equal(buildIntakeFileCertificateMetadata(state), null);
});
