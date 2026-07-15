import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { DbClient } from "../../db/client.ts";
import type { ResultPersistenceService } from "../../persistence/resultPersistence.ts";
import type {
  PrepareResultPersistenceInput,
  PreparedResultIntent,
} from "../../persistence/types.ts";
import type { WorkflowState } from "../types.ts";
import { createPersistValidatedNode } from "./persistResults.ts";

function createState(): WorkflowState {
  const source = Buffer.from("single-page-pdf");
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
      modifiedTime: "2025-09-15T10:30:00.000Z",
      mimeType: "application/pdf",
      sizeBytes: source.length,
      artifactUri: "s3://source-bucket/uploads/source.pdf",
      uploadedByUserId: "user-1",
      uploadedAt: "2025-09-15T10:30:00.000Z",
      receivedAt: "2025-09-15T10:30:00.000Z",
      selectedEntity: {
        id: 1,
        shortName: "TMI",
        companyName: "Therma Mobile, Inc.",
        tin: "266566116000",
      },
    },
    jobId: "job-1",
    source: {
      uri: "s3://source-bucket/uploads/source.pdf",
      bucket: "source-bucket",
      key: "uploads/source.pdf",
      mimeType: "application/pdf",
      hash: createHash("sha256").update(source).digest("hex"),
    },
    artifactKeys: { source: "uploads/source.pdf" },
    decision: {
      terminalStatus: "Done",
      route: "continue",
      reasonCodes: [],
      phase: "persist",
    },
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        sourceContentBase64: source.toString("base64"),
        normalized: {
          periodEnd: "08-31-2025",
          payeeName: "Therma Mobile, Inc.",
          payeeTin: "266-566-116-00000",
          payorName: "Customer A",
          payorTin: "123-456-789-000",
        },
        validation: { status: "valid", reasons: [], checks: [] },
      },
    ],
  };
}

function createLookupDb(): DbClient {
  let lookup = 0;
  const rows = [[{ shortName: "TMI" }], [{ shortName: "CUSTA" }]];
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows[lookup++] ?? [],
          }),
        }),
      }),
    }),
  } as unknown as DbClient;
}

function createPersistenceCapture() {
  let input: PrepareResultPersistenceInput | undefined;
  let intent: PreparedResultIntent | undefined;
  const service: ResultPersistenceService = {
    hasExisting: async () => false,
    persistPreparedResult: async (nextInput, jobId) => {
      input = nextInput;
      assert.equal(jobId, "job-1");
      intent = nextInput.build({
        documentResultId: 123,
        processedNumber: 7,
        preparedAt: "2025-09-15T10:31:00.000Z",
      });
      const payload = intent.documentResult.payload as {
        artifactKeys: Record<string, string>;
      };
      return {
        operationId: "operation-1",
        documentResultId: 123,
        outcome: nextInput.outcome,
        artifactKey: intent.documentResult.artifactKey ?? undefined,
        artifactKeys: payload.artifactKeys,
        decision: {
          terminalStatus: nextInput.outcome,
          route: "continue",
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

test("validated persistence builds one frozen success intent", async () => {
  const capture = createPersistenceCapture();
  const node = createPersistValidatedNode({
    db: createLookupDb(),
    bucket: "result-bucket",
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: () => {
        throw new Error("unused");
      },
    },
    persistence: capture.service,
  });

  const result = await node(createState());
  const input = capture.input;
  const intent = capture.intent;
  assert.ok(input);
  assert.ok(intent);
  assert.equal(input.outcome, "Done");
  assert.equal(input.payorShortName, "CUSTA");
  assert.equal(input.uploadedAt, "2025-09-15T10:30:00.000Z");
  assert.equal(intent.documentResult.payeeShortName, "TMI");
  assert.equal(intent.documentResult.payorShortName, "CUSTA");
  assert.equal(intent.documentResult.status, "success");
  assert.equal(intent.artifacts.length, 3);
  assert.deepEqual(
    intent.artifacts.map((artifact) => artifact.role),
    ["raw_json", "final_json", "unsigned_pdf"],
  );

  const payload = intent.documentResult.payload as {
    artifactKeys: Record<string, string>;
  };
  assert.equal(
    intent.documentResult.artifactKey,
    payload.artifactKeys.finalResultJson,
  );
  assert.equal(intent.documentResult.finalKey, payload.artifactKeys.renamedPdf);
  assert.match(String(intent.documentResult.finalKey), /\/123\//u);
  assert.match(String(intent.documentResult.finalKey), /_7\.pdf$/u);
  assert.deepEqual(result.artifactKeys, payload.artifactKeys);

  const rawArtifact = intent.artifacts.find(
    (artifact) => artifact.role === "raw_json",
  );
  assert.ok(rawArtifact?.body.kind === "text");
  assert.equal(
    JSON.parse(rawArtifact.body.text).generatedAt,
    "2025-09-15T10:31:00.000Z",
  );

  const pdfArtifact = intent.artifacts.find(
    (artifact) => artifact.role === "unsigned_pdf",
  );
  assert.ok(pdfArtifact?.body.kind === "source_page");
  assert.equal(pdfArtifact.body.sourceBucket, "source-bucket");
  assert.equal(pdfArtifact.body.sourceKey, "uploads/source.pdf");
  assert.equal(pdfArtifact.body.sourcePageNumber, 1);
});

test("validated persistence rejects a result without immutable source metadata", async () => {
  const state = createState();
  state.source = undefined;
  const capture = createPersistenceCapture();
  const node = createPersistValidatedNode({
    db: createLookupDb(),
    bucket: "result-bucket",
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: () => {
        throw new Error("unused");
      },
    },
    persistence: capture.service,
  });

  await assert.rejects(node(state), /source page and source object metadata/u);
  assert.equal(capture.intent, undefined);
});
