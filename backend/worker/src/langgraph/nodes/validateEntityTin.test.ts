import assert from "node:assert/strict";
import test from "node:test";

import { createValidateEntityTinNode } from "./validateEntityTin.ts";
import type { WorkflowState } from "../types.ts";

const validateEntityTin = createValidateEntityTinNode();

function buildState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    event: {
      version: "v1",
      eventId: "event-1",
      traceId: "trace-1",
      source: "manual-upload",
      batchId: "7de4cd8e-6be8-4928-a2cb-e417654c8e15",
      uploadId: "9de4cd8e-6be8-4928-a2cb-e417654c8e15",
      sourceFileId: "source-1",
      revision: "rev-1",
      originalFileName: "certificate.pdf",
      modifiedTime: "2026-05-07T00:00:00.000Z",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      artifactUri: "s3://bucket/certificate.pdf",
      selectedEntity: {
        shortName: "TMO",
        companyName: "Therma Mobile Inc.",
        tin: "266-566-116-00000",
      },
      uploadedByUserId: "user-1",
      uploadedAt: "2026-05-07T00:00:00.000Z",
      receivedAt: "2026-05-07T00:00:00.000Z",
    },
    jobId: "job-1",
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        normalized: {
          payeeTin: "266566116123",
        },
      },
    ],
    batchSummary: {
      totalPages: 1,
      certificatePageNumbers: [1],
      ignoredPageNumbers: [],
      validPageNumbers: [],
      failedPageNumbers: [],
      duplicatePageNumbers: [],
    },
    ...overrides,
  } as WorkflowState;
}

test("validateEntityTin continues when first 9 TIN digits match", async () => {
  const result = await validateEntityTin(buildState());

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.validation, undefined);
});

test("validateEntityTin ignores branch suffix differences", async () => {
  const result = await validateEntityTin(
    buildState({
      pages: [
        {
          pageNumber: 1,
          classification: "certificate",
          normalized: {
            payeeTin: "266-566-116-99999",
          },
        },
      ],
    }),
  );

  assert.equal(result.decision?.route, "continue");
});

test("validateEntityTin fails when selected entity and payee TIN differ", async () => {
  const result = await validateEntityTin(
    buildState({
      pages: [
        {
          pageNumber: 1,
          classification: "certificate",
          normalized: {
            payeeTin: "999-566-116-00000",
          },
        },
      ],
    }),
  );

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, ["entity_payee_tin_mismatch"]);
  assert.equal(result.validation?.checks[0]?.code, "ENTITY_PAYEE_TIN_MATCH");
});

test("validateEntityTin fails when selected entity is missing", async () => {
  const state = buildState();
  delete state.event.selectedEntity;

  const result = await validateEntityTin(state);

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, ["missing_selected_entity"]);
});

test("validateEntityTin fails when payee TIN is too short", async () => {
  const result = await validateEntityTin(
    buildState({
      pages: [
        {
          pageNumber: 1,
          classification: "certificate",
          normalized: {
            payeeTin: "12345",
          },
        },
      ],
    }),
  );

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "missing_payee_tin_for_entity_match",
  ]);
});
