import assert from "node:assert/strict";
import test from "node:test";

import type { S3Client } from "@aws-sdk/client-s3";
import {
  loadWorkerEnv,
  type DocumentIngestEventV1,
  type Logger,
} from "@taxgenie/shared";
import type { DbClient } from "../db/client.ts";
import {
  documentExtractionAttempts,
  intakeBatches,
  intakeFiles,
  workerJobs,
} from "../db/schema.ts";
import type {
  TerminalIdempotencyState,
  WorkerEventClaim,
  WorkerIdempotencyRepository,
} from "../db/workerIdempotency.ts";
import type { WorkflowInvokeOptions } from "../langgraph/graph.ts";
import type { WorkflowOutcome, WorkflowState } from "../langgraph/types.ts";
import type { ClaimLeaseHeartbeatInput } from "./claimLeaseHeartbeat.ts";
import { ClaimOwnershipLostError } from "./claimLeaseHeartbeat.ts";
import { createMessageHandler } from "./messageHandler.ts";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const env = loadWorkerEnv({
  NODE_ENV: "test",
  AWS_REGION: "ap-southeast-1",
  SQS_QUEUE_URL: "https://sqs.example.test/queue",
  S3_BUCKET_NAME: "test-bucket",
  ADMIN_TOKEN: "test-admin-token",
  GEMINI_API_KEY: "test-key",
  GEMINI_MODEL: "gemini-3-flash-preview",
  GEMINI_THINKING_LEVEL: "high",
  GEMINI_MEDIA_RESOLUTION: "medium",
  GEMINI_TIMEOUT_MS: "180000",
  TAXGENIE_LANGSMITH_ENABLED: "false",
});

const event: DocumentIngestEventV1 = {
  version: "v1",
  eventId: "event-1",
  traceId: "trace-1",
  source: "manual-upload",
  batchId: "11111111-1111-4111-8111-111111111111",
  uploadId: "22222222-2222-4222-8222-222222222222",
  sourceFileId: "source-1",
  revision: "revision-1",
  originalFileName: "certificate.pdf",
  modifiedTime: "2026-07-13T00:00:00.000Z",
  mimeType: "application/pdf",
  sizeBytes: 100,
  artifactUri: "https://bucket.example.test/source.pdf",
  uploadedByUserId: "user-1",
  uploadedAt: "2026-07-13T00:00:00.000Z",
  receivedAt: "2026-07-13T00:00:00.000Z",
};

const rawBody = JSON.stringify({ event });

function createFakeDb(input: { purgeStatus?: string | null } = {}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  let transactionCount = 0;
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          for: () => ({
            limit: async () =>
              table === intakeFiles
                ? [
                    {
                      id: event.uploadId,
                      purgeStatus: input.purgeStatus ?? null,
                      removedFromBatchAt: null,
                    },
                  ]
                : table === intakeBatches
                  ? [{ id: event.batchId, deletedAt: null }]
                  : [],
          }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return {
          returning: async () => [{ id: 501 }],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push({ table, values });
          return [];
        },
      }),
    }),
  };
  const db = {
    transaction: async (
      callback: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      transactionCount += 1;
      return callback(tx);
    },
  } as unknown as DbClient;

  return {
    db,
    inserts,
    updates,
    get transactionCount() {
      return transactionCount;
    },
  };
}

function createClaim(
  input: {
    idempotencyKey?: string;
    claimOwner?: string;
    jobId?: string;
    attemptNumber?: number;
  } = {},
): WorkerEventClaim {
  return {
    idempotencyKey: input.idempotencyKey ?? event.eventId,
    claimOwner: input.claimOwner ?? "attempt-1",
    jobId: input.jobId ?? "job_attempt-1",
    attemptNumber: input.attemptNumber ?? 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };
}

function createWorkflow(terminalStatus: WorkflowOutcome = "Done") {
  let invocationCount = 0;
  const invokedStates: WorkflowState[] = [];
  const invokeOptions: WorkflowInvokeOptions[] = [];
  return {
    workflow: {
      invoke: async (
        state: WorkflowState,
        options?: WorkflowInvokeOptions,
      ) => {
        invocationCount += 1;
        invokedStates.push(state);
        invokeOptions.push(options ?? {});
        return {
          ...state,
          decision: {
            route: terminalStatus === "Duplicate" ? "duplicate" : "continue",
            phase: "persist",
            terminalStatus,
            reasonCodes: [],
          },
        } as WorkflowState;
      },
    },
    get invocationCount() {
      return invocationCount;
    },
    get invokedStates() {
      return invokedStates;
    },
    get invokeOptions() {
      return invokeOptions;
    },
  };
}

function noOpHeartbeat() {
  return {
    hasLostOwnership: () => false,
    stop: async () => undefined,
  };
}

test("concurrent handlers invoke the workflow exactly once", async () => {
  const fakeDb = createFakeDb();
  const workflow = createWorkflow();
  let claimed = false;
  let completed = 0;
  const repository: WorkerIdempotencyRepository = {
    claim: async (_db, input) => {
      if (claimed) {
        return {
          kind: "busy",
          terminalState: "running",
          claimOwner: "attempt-1",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        };
      }

      claimed = true;
      return {
        kind: "acquired",
        takeover: false,
        claim: createClaim({
          idempotencyKey: input.idempotencyKey,
          claimOwner: input.claimOwner,
          jobId: input.jobId,
        }),
      };
    },
    renew: async () => new Date(Date.now() + 60_000),
    complete: async () => {
      completed += 1;
      return true;
    },
    fail: async () => true,
  };
  let attemptNumber = 0;
  const traceCallback = { name: "test-tracer" } as never;
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: workflow.workflow,
    idempotencyRepository: repository,
    createAttemptId: () => `attempt-${++attemptNumber}`,
    startLeaseHeartbeat: noOpHeartbeat,
    callbacks: [traceCallback],
  });

  const dispositions = await Promise.all([handler(rawBody), handler(rawBody)]);

  assert.deepEqual(dispositions.map((disposition) => disposition.kind).sort(), [
    "acknowledge",
    "retry",
  ]);
  assert.equal(workflow.invocationCount, 1);
  assert.deepEqual(workflow.invokeOptions[0]?.callbacks, [traceCallback]);
  assert.equal(workflow.invokedStates[0]?.extractionAttemptId, 501);
  const attemptInsert = fakeDb.inserts.find(
    (entry) => entry.table === documentExtractionAttempts,
  )?.values as Record<string, unknown>;
  assert.equal(attemptInsert.trigger, "initial");
  assert.equal(attemptInsert.retryNumber, 0);
  assert.equal(attemptInsert.status, "processing");
  assert.equal(completed, 1);
  assert.equal(fakeDb.transactionCount, 2);
});

test("claim takeovers preserve the old cost-bearing attempt and create a new one", async () => {
  const fakeDb = createFakeDb();
  const workflow = createWorkflow();
  const takeoverEvent = {
    ...event,
    revision: "manual-retry-2-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  };
  const repository: WorkerIdempotencyRepository = {
    claim: async () => ({
      kind: "acquired",
      takeover: true,
      claim: createClaim({
        jobId: "job_attempt-2",
        attemptNumber: 2,
      }),
    }),
    renew: async () => new Date(Date.now() + 60_000),
    complete: async () => true,
    fail: async () => true,
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: workflow.workflow,
    idempotencyRepository: repository,
    startLeaseHeartbeat: noOpHeartbeat,
  });

  assert.deepEqual(await handler(JSON.stringify({ event: takeoverEvent })), {
    kind: "acknowledge",
  });
  assert.deepEqual(workflow.invokeOptions[0]?.callbacks, []);

  const attemptInsert = fakeDb.inserts.find(
    (entry) => entry.table === documentExtractionAttempts,
  )?.values as Record<string, unknown>;
  assert.equal(attemptInsert.workerAttemptNumber, 2);
  assert.equal(attemptInsert.trigger, "manual_retry");
  assert.equal(attemptInsert.retryNumber, 2);
  assert.equal(
    fakeDb.updates.some(
      (entry) =>
        entry.table === documentExtractionAttempts &&
        (entry.values as Record<string, unknown>).status === "failed" &&
        (
          (entry.values as Record<string, unknown>).reasonCodes as Array<string>
        )?.includes("claim_lease_expired"),
    ),
    true,
  );
  assert.equal(
    fakeDb.updates.some(
      (entry) =>
        entry.table === workerJobs &&
        (entry.values as Record<string, unknown>).currentStep ===
          "lease_expired",
    ),
    true,
  );
});

test("terminal replays acknowledge without job or workflow work", async () => {
  const fakeDb = createFakeDb();
  const workflow = createWorkflow();
  const repository: WorkerIdempotencyRepository = {
    claim: async () => ({
      kind: "terminal_replay",
      terminalState: "success",
      jobId: "job_attempt-1",
    }),
    renew: async () => assert.fail("terminal replay must not renew"),
    complete: async () => assert.fail("terminal replay must not complete"),
    fail: async () => assert.fail("terminal replay must not fail"),
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: workflow.workflow,
    idempotencyRepository: repository,
  });

  assert.deepEqual(await handler(rawBody), { kind: "acknowledge" });
  assert.equal(workflow.invocationCount, 0);
  assert.equal(fakeDb.transactionCount, 0);
});

for (const [workflowOutcome, expectedState] of [
  ["Error", "error"],
  ["Duplicate", "duplicate"],
] as const satisfies ReadonlyArray<
  readonly [WorkflowOutcome, TerminalIdempotencyState]
>) {
  test(`workflow outcome ${workflowOutcome} finalizes the ${expectedState} claim state`, async () => {
    const fakeDb = createFakeDb();
    const workflow = createWorkflow(workflowOutcome);
    const completedStates: TerminalIdempotencyState[] = [];
    const repository: WorkerIdempotencyRepository = {
      claim: async () => ({
        kind: "acquired",
        takeover: false,
        claim: createClaim(),
      }),
      renew: async () => new Date(Date.now() + 60_000),
      complete: async (_db, _claim, terminalState) => {
        completedStates.push(terminalState);
        return true;
      },
      fail: async () => true,
    };
    const handler = createMessageHandler({
      db: fakeDb.db,
      s3: {} as S3Client,
      env,
      logger,
      workflow: workflow.workflow,
      idempotencyRepository: repository,
      startLeaseHeartbeat: noOpHeartbeat,
    });

    assert.deepEqual(await handler(rawBody), { kind: "acknowledge" });
    assert.deepEqual(completedStates, [expectedState]);
  });
}

test("workflow failures release an owned claim and remain retryable", async () => {
  const fakeDb = createFakeDb();
  let failCount = 0;
  const repository: WorkerIdempotencyRepository = {
    claim: async () => ({
      kind: "acquired",
      takeover: false,
      claim: createClaim(),
    }),
    renew: async () => new Date(Date.now() + 60_000),
    complete: async () => assert.fail("failed workflows must not complete"),
    fail: async () => {
      failCount += 1;
      return true;
    },
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: {
      invoke: async () => {
        throw new Error("provider unavailable");
      },
    },
    idempotencyRepository: repository,
    startLeaseHeartbeat: noOpHeartbeat,
  });

  await assert.rejects(() => handler(rawBody), /provider unavailable/);
  assert.equal(failCount, 1);
});

test("queued permanent deletion prevents extraction initialization", async () => {
  const fakeDb = createFakeDb({ purgeStatus: "queued" });
  let failCount = 0;
  const workflow = createWorkflow();
  const repository: WorkerIdempotencyRepository = {
    claim: async () => ({
      kind: "acquired",
      takeover: false,
      claim: createClaim(),
    }),
    renew: async () => new Date(Date.now() + 60_000),
    complete: async () => assert.fail("blocked work must not complete"),
    fail: async () => {
      failCount += 1;
      return true;
    },
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: workflow.workflow,
    idempotencyRepository: repository,
    startLeaseHeartbeat: noOpHeartbeat,
  });

  await assert.rejects(
    () => handler(rawBody),
    /unavailable because deletion has started/u,
  );
  assert.equal(workflow.invocationCount, 0);
  assert.equal(failCount, 1);
});

test("lease loss aborts the graph and cannot release or complete a replacement claim", async () => {
  const fakeDb = createFakeDb();
  let completeCount = 0;
  let failCount = 0;
  let heartbeatInput: ClaimLeaseHeartbeatInput | undefined;
  let ownershipLost = false;
  const repository: WorkerIdempotencyRepository = {
    claim: async () => ({
      kind: "acquired",
      takeover: false,
      claim: createClaim(),
    }),
    renew: async () => null,
    complete: async () => {
      completeCount += 1;
      return false;
    },
    fail: async () => {
      failCount += 1;
      return false;
    },
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: {
      invoke: async (_state, options) => {
        ownershipLost = true;
        heartbeatInput?.onOwnershipLost(
          new ClaimOwnershipLostError("lease lost"),
        );
        assert.equal(options?.signal?.aborted, true);
        throw new Error("aborted");
      },
    },
    idempotencyRepository: repository,
    startLeaseHeartbeat: (input: ClaimLeaseHeartbeatInput) => {
      heartbeatInput = input;
      return {
        hasLostOwnership: () => ownershipLost,
        stop: async () => undefined,
      };
    },
  });

  await assert.rejects(
    () => handler(rawBody),
    (error: unknown) =>
      error instanceof ClaimOwnershipLostError &&
      error.message === "lease lost",
  );
  assert.equal(completeCount, 0);
  assert.equal(failCount, 1);
  assert.equal(
    fakeDb.updates.some(
      (entry) =>
        entry.table === documentExtractionAttempts &&
        (entry.values as Record<string, unknown>).status === "failed" &&
        (
          (entry.values as Record<string, unknown>).reasonCodes as Array<string>
        )?.includes("claim_lost"),
    ),
    true,
  );
});

test("invalid JSON is classified as poison before database or workflow work", async () => {
  const fakeDb = createFakeDb();
  const workflow = createWorkflow();
  let claimCount = 0;
  const repository: WorkerIdempotencyRepository = {
    claim: async () => {
      claimCount += 1;
      assert.fail("invalid JSON must not claim worker work");
    },
    renew: async () => assert.fail("invalid JSON must not renew a claim"),
    complete: async () => assert.fail("invalid JSON must not complete a claim"),
    fail: async () => assert.fail("invalid JSON must not fail a claim"),
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: workflow.workflow,
    idempotencyRepository: repository,
  });

  assert.deepEqual(await handler("{"), {
    kind: "poison",
    reason: "invalid_json",
  });
  assert.equal(claimCount, 0);
  assert.equal(workflow.invocationCount, 0);
  assert.equal(fakeDb.transactionCount, 0);
});

test("invalid event schemas return sanitized poison details without starting work", async () => {
  const fakeDb = createFakeDb();
  const workflow = createWorkflow();
  let claimCount = 0;
  const repository: WorkerIdempotencyRepository = {
    claim: async () => {
      claimCount += 1;
      assert.fail("invalid schemas must not claim worker work");
    },
    renew: async () => assert.fail("invalid schemas must not renew a claim"),
    complete: async () =>
      assert.fail("invalid schemas must not complete a claim"),
    fail: async () => assert.fail("invalid schemas must not fail a claim"),
  };
  const handler = createMessageHandler({
    db: fakeDb.db,
    s3: {} as S3Client,
    env,
    logger,
    workflow: workflow.workflow,
    idempotencyRepository: repository,
  });

  const disposition = await handler(
    JSON.stringify({ event: { ...event, eventId: "" } }),
  );

  assert.equal(disposition.kind, "poison");
  assert.equal(
    disposition.kind === "poison" ? disposition.reason : undefined,
    "invalid_event_schema",
  );
  assert.deepEqual(
    disposition.kind === "poison" ? disposition.validationIssues : undefined,
    [{ code: "too_small", path: "event.eventId" }],
  );
  assert.equal(claimCount, 0);
  assert.equal(workflow.invocationCount, 0);
  assert.equal(fakeDb.transactionCount, 0);
});
