import assert from "node:assert/strict";
import test from "node:test";

import type { DbClient } from "../../db/client.ts";
import type { ResultPersistenceService } from "../../persistence/resultPersistence.ts";
import type {
  PrepareResultPersistenceInput,
  PreparedResultIntent,
} from "../../persistence/types.ts";
import type { WorkflowOutcome, WorkflowState } from "../types.ts";
import { createPersistDuplicateNode } from "./persistDuplicate.ts";
import { createPersistValidationFailNode } from "./persistValidationFail.ts";

function createDb(): DbClient {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  } as unknown as DbClient;
}

function createState(outcome: WorkflowOutcome): WorkflowState {
  return {
    event: {
      version: "v1",
      eventId: `event-${outcome}`,
      traceId: `trace-${outcome}`,
      source: "manual-upload",
      batchId: "11111111-1111-4111-8111-111111111111",
      uploadId: "22222222-2222-4222-8222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "certificate.pdf",
      modifiedTime: "2026-07-13T00:00:00.000Z",
      mimeType: "application/pdf",
      sizeBytes: 100,
      artifactUri: "s3://source-bucket/source.pdf",
      uploadedByUserId: "user-1",
      uploadedAt: "2026-07-13T00:00:00.000Z",
      receivedAt: "2026-07-13T00:00:00.000Z",
    },
    jobId: "job-1",
    normalized: { payorName: "Payor" },
    artifactKeys: { source: "source.pdf" },
    validation: {
      status: "invalid",
      reasons: outcome === "Duplicate" ? ["duplicate"] : ["invalid_tin"],
      checks: [],
    },
    decision: {
      terminalStatus: outcome,
      route: outcome === "Duplicate" ? "duplicate" : "error",
      reasonCodes: outcome === "Duplicate" ? ["duplicate"] : ["invalid_tin"],
      phase: "persist",
    },
  };
}

function createCapture() {
  let input: PrepareResultPersistenceInput | undefined;
  let intent: PreparedResultIntent | undefined;
  const service: ResultPersistenceService = {
    hasExisting: async () => false,
    persistPreparedResult: async (next) => {
      input = next;
      intent = next.build({
        documentResultId: 42,
        processedNumber: 1,
        preparedAt: "2026-07-13T00:01:00.000Z",
      });
      const payload = intent.documentResult.payload as {
        artifactKeys: Record<string, string>;
      };
      return {
        operationId: "operation-1",
        documentResultId: 42,
        outcome: next.outcome,
        artifactKey: intent.documentResult.artifactKey ?? undefined,
        artifactKeys: payload.artifactKeys,
        decision: {
          terminalStatus: next.outcome,
          route: next.outcome === "Duplicate" ? "duplicate" : "error",
          reasonCodes: [],
          phase: "persist",
        },
      };
    },
    resumeExisting: async () => null,
    listEligible: async () => [],
    getBacklog: async () => ({ count: 0, oldestCreatedAt: null }),
    blockInvalidIntent: async () => undefined,
  };
  return {
    service,
    get input() {
      return input;
    },
    get intent() {
      return intent;
    },
  };
}

for (const outcome of ["Error", "Duplicate"] as const) {
  test(`${outcome} persistence writes only a terminal JSON pointer`, async () => {
    const capture = createCapture();
    const node =
      outcome === "Error"
        ? createPersistValidationFailNode({
            db: createDb(),
            bucket: "result-bucket",
            persistence: capture.service,
          })
        : createPersistDuplicateNode({
            db: createDb(),
            bucket: "result-bucket",
            persistence: capture.service,
          });

    await node(createState(outcome));
    const input = capture.input;
    const intent = capture.intent;
    assert.ok(input);
    assert.ok(intent);
    assert.equal(input.outcome, outcome);
    assert.equal(intent.documentResult.finalKey, null);
    assert.equal(intent.artifacts.length, 1);
    assert.equal(intent.artifacts[0]?.role, "final_json");

    const payload = intent.documentResult.payload as {
      artifactKeys: Record<string, string>;
    };
    assert.equal(
      intent.documentResult.artifactKey,
      payload.artifactKeys.finalResultJson,
    );
    assert.equal(payload.artifactKeys.rawResultJson, undefined);
    assert.equal(payload.artifactKeys.renamedPdf, undefined);
  });
}
