import assert from "node:assert/strict";
import test from "node:test";

import { createNormalizeFieldsNode } from "./normalizeFields.ts";
import type { ExtractionPayload, WorkflowState } from "../types.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const MULTIPLE_CERTIFICATE_REASON_CODE =
  "multiple_certificate_pages_detected";

function buildExtraction(parsedText: string): ExtractionPayload {
  return {
    provider: "test",
    startedAt: "2026-04-29T00:00:00.000Z",
    finishedAt: "2026-04-29T00:00:01.000Z",
    durationMs: 1,
    raw: { text: parsedText },
    parsedText,
    metadata: {},
  };
}

function buildState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "certificate.pdf",
    },
    jobId: "job-1",
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        extraction: buildExtraction("first certificate"),
        extracted: { text: "first certificate" },
      },
      {
        pageNumber: 2,
        classification: "non_certificate",
        extraction: buildExtraction("cover memo"),
        extracted: { text: "cover memo" },
      },
      {
        pageNumber: 3,
        classification: "certificate",
        extraction: buildExtraction("second certificate"),
        extracted: { text: "second certificate" },
      },
    ],
    batchSummary: {
      totalPages: 3,
      certificatePageNumbers: [1, 3],
      ignoredPageNumbers: [2],
      validPageNumbers: [],
      failedPageNumbers: [1, 3],
      duplicatePageNumbers: [],
    },
    validation: {
      status: "invalid",
      reasons: [MULTIPLE_CERTIFICATE_REASON_CODE],
      checks: [
        {
          code: "MULTIPLE_CERTIFICATE_PAGES_DETECTED",
          passed: false,
          message:
            "Multiple BIR 2307 certificate pages were detected: page 1, page 3",
        },
      ],
    },
    decision: {
      terminalStatus: "Done",
      route: "continue",
      reasonCodes: [MULTIPLE_CERTIFICATE_REASON_CODE],
      phase: "normalize",
      sourceFileId: "source-1",
      revision: "v1",
    },
    ...overrides,
  } as WorkflowState;
}

test("normalizeFields normalizes only the first certificate page before routing multiple-certificate files to validation failure", async () => {
  const calls: Array<{
    extraction: ExtractionPayload;
    sourceFileId: string;
    revision: string;
  }> = [];
  const fields = {
    periodCovered: "08-01-2025 to 08-31-2025",
    payeeName: "First Payee",
    payeeTin: "111-222-333-000",
    payorName: "First Payor",
    payorTin: "444-555-666-000",
    atcCode: "WC160",
    taxWithheld: 2.5,
  };
  const normalizeFields = createNormalizeFieldsNode({
    logger: logger as never,
    normalizer: async (input) => {
      calls.push(input);
      return { fields };
    },
  });

  const result = await normalizeFields(buildState());

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.sourceFileId, "source-1");
  assert.equal(calls[0]?.revision, "v1-page-1");
  assert.equal(calls[0]?.extraction.parsedText, "first certificate");
  assert.equal(result.decision?.route, "error");
  assert.equal(result.decision?.terminalStatus, "Error");
  assert.equal(result.decision?.phase, "normalize");
  assert.deepEqual(result.decision?.reasonCodes, [
    MULTIPLE_CERTIFICATE_REASON_CODE,
  ]);
  assert.equal(result.validation?.reasons[0], MULTIPLE_CERTIFICATE_REASON_CODE);
  assert.deepEqual(result.normalized, fields);
  assert.deepEqual(result.pages?.[0]?.normalized, fields);
  assert.equal(result.pages?.[2]?.normalized, undefined);
  assert.deepEqual(result.batchSummary?.certificatePageNumbers, [1, 3]);
  assert.deepEqual(result.batchSummary?.failedPageNumbers, [1, 3]);
});

test("normalizeFields continues for a single certificate page", async () => {
  const normalizeFields = createNormalizeFieldsNode({
    logger: logger as never,
    normalizer: async () => ({
      fields: {
        payeeName: "Only Payee",
      },
    }),
  });

  const result = await normalizeFields(
    buildState({
      pages: [
        {
          pageNumber: 2,
          classification: "certificate",
          extraction: buildExtraction("only certificate"),
          extracted: { text: "only certificate" },
        },
      ],
      batchSummary: {
        totalPages: 1,
        certificatePageNumbers: [2],
        ignoredPageNumbers: [],
        validPageNumbers: [],
        failedPageNumbers: [],
        duplicatePageNumbers: [],
      },
      validation: undefined,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: [],
        phase: "normalize",
        sourceFileId: "source-1",
        revision: "v1",
      },
    }),
  );

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.decision?.terminalStatus, "Done");
  assert.equal(result.decision?.phase, "validate");
  assert.deepEqual(result.normalized, { payeeName: "Only Payee" });
});
