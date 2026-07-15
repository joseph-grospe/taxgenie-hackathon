import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type { Logger } from "@taxtrack/shared";
import {
  calculateReceiveBackoffMs,
  processSqsMessage,
  SqsPoller,
  type MessageDisposition,
} from "./sqsPoller.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(
  condition: () => boolean,
  message = "condition was not met",
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function pendingUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectForAbort = () => {
      const error = new Error("receive aborted");
      error.name = "AbortError";
      reject(error);
    };

    if (signal?.aborted) {
      rejectForAbort();
      return;
    }
    signal?.addEventListener("abort", rejectForAbort, { once: true });
  });
}

function createLogger() {
  const infoLogs: Array<{ message: string; meta?: Record<string, unknown> }> =
    [];
  const warnLogs: Array<{ message: string; meta?: Record<string, unknown> }> =
    [];
  const errorLogs: Array<{ message: string; meta?: Record<string, unknown> }> =
    [];
  const logger: Logger = {
    debug: () => undefined,
    info: (message, meta) => infoLogs.push({ message, meta }),
    warn: (message, meta) => warnLogs.push({ message, meta }),
    error: (message, meta) => errorLogs.push({ message, meta }),
    child: () => logger,
  };

  return { logger, infoLogs, warnLogs, errorLogs };
}

test("poller starts visibility protection before processing and deletes acknowledged messages", async () => {
  const commands: unknown[] = [];
  const { logger } = createLogger();
  let heartbeatStarted = false;
  let heartbeatStopped = false;
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  } as unknown as SQSClient;

  await processSqsMessage({
    client,
    queueUrl: "https://sqs.example.test/queue",
    visibilityTimeoutSeconds: 300,
    logger,
    message: {
      MessageId: "message-1",
      Body: "{}",
      ReceiptHandle: "receipt-1",
      Attributes: { ApproximateReceiveCount: "2" },
    },
    processMessage: async () => {
      assert.equal(heartbeatStarted, true);
      return { kind: "acknowledge" };
    },
    startHeartbeat: () => {
      heartbeatStarted = true;
      return async () => {
        heartbeatStopped = true;
      };
    },
  });

  assert.equal(heartbeatStopped, true);
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof DeleteMessageCommand);
});

for (const disposition of [
  { kind: "retry", reason: "claim_busy" },
  { kind: "poison", reason: "invalid_json" },
] as const satisfies ReadonlyArray<MessageDisposition>) {
  test(`poller leaves ${disposition.kind} messages unacknowledged`, async () => {
    const commands: unknown[] = [];
    const { logger } = createLogger();
    let heartbeatStopped = false;
    const client = {
      send: async (command: unknown) => {
        commands.push(command);
        return {};
      },
    } as unknown as SQSClient;

    await processSqsMessage({
      client,
      queueUrl: "https://sqs.example.test/queue",
      visibilityTimeoutSeconds: 300,
      logger,
      message: {
        MessageId: `message-${disposition.kind}`,
        Body: "{}",
        ReceiptHandle: `receipt-${disposition.kind}`,
      },
      processMessage: async () => disposition,
      startHeartbeat: () => async () => {
        heartbeatStopped = true;
      },
    });

    assert.deepEqual(commands, []);
    assert.equal(heartbeatStopped, true);
  });
}

test("poller leaves thrown processing failures unacknowledged", async () => {
  const commands: unknown[] = [];
  const { logger, errorLogs } = createLogger();
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  } as unknown as SQSClient;

  await processSqsMessage({
    client,
    queueUrl: "https://sqs.example.test/queue",
    visibilityTimeoutSeconds: 300,
    logger,
    message: {
      MessageId: "message-3",
      Body: "{}",
      ReceiptHandle: "receipt-3",
    },
    processMessage: async () => {
      throw new Error("boom");
    },
    startHeartbeat: () => async () => undefined,
  });

  assert.deepEqual(commands, []);
  assert.ok(
    errorLogs.some(
      ({ message }) => message === "Failed processing SQS message",
    ),
  );
});

test("poller receives only available capacity and waits when all slots are occupied", async () => {
  const { logger } = createLogger();
  const receiveCommands: ReceiveMessageCommand[] = [];
  const handlers = new Map<string, Deferred<MessageDisposition>>([
    ["message-1", deferred<MessageDisposition>()],
    ["message-2", deferred<MessageDisposition>()],
    ["message-3", deferred<MessageDisposition>()],
  ]);
  const startedBodies: string[] = [];
  const client = {
    send: async (command: unknown, options?: { abortSignal?: AbortSignal }) => {
      if (command instanceof ReceiveMessageCommand) {
        receiveCommands.push(command);
        if (receiveCommands.length === 1) {
          return {
            Messages: [1, 2, 3].map((index) => ({
              MessageId: `id-${index}`,
              Body: `message-${index}`,
              ReceiptHandle: `receipt-${index}`,
            })),
          };
        }
        return pendingUntilAbort(options?.abortSignal);
      }
      return {};
    },
  } as unknown as SQSClient;
  const poller = new SqsPoller({
    client,
    queueUrl: "https://sqs.example.test/queue",
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 300,
    concurrency: 3,
    logger,
    processMessage: async (body) => {
      startedBodies.push(body);
      return handlers.get(body)!.promise;
    },
    startHeartbeat: () => async () => undefined,
  });

  poller.start();
  await waitFor(() => startedBodies.length === 3);
  assert.equal(receiveCommands.length, 1);
  assert.equal(receiveCommands[0].input.MaxNumberOfMessages, 3);
  assert.deepEqual(receiveCommands[0].input.MessageSystemAttributeNames, [
    "ApproximateReceiveCount",
  ]);

  handlers.get("message-1")!.resolve({ kind: "acknowledge" });
  await waitFor(() => receiveCommands.length === 2);
  assert.equal(receiveCommands[1].input.MaxNumberOfMessages, 1);

  const drainPromise = poller.drain();
  handlers.get("message-2")!.resolve({ kind: "acknowledge" });
  handlers.get("message-3")!.resolve({ kind: "acknowledge" });
  await drainPromise;
});

test("poller caps each receive at ten and drain aborts a long poll without logging an error", async () => {
  const { logger, errorLogs } = createLogger();
  const receiveCommands: ReceiveMessageCommand[] = [];
  const client = {
    send: async (command: unknown, options?: { abortSignal?: AbortSignal }) => {
      if (command instanceof ReceiveMessageCommand) {
        receiveCommands.push(command);
        return pendingUntilAbort(options?.abortSignal);
      }
      return {};
    },
  } as unknown as SQSClient;
  const poller = new SqsPoller({
    client,
    queueUrl: "https://sqs.example.test/queue",
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 300,
    concurrency: 12,
    logger,
    processMessage: async () => ({ kind: "acknowledge" }),
  });

  poller.start();
  await waitFor(() => receiveCommands.length === 1);
  assert.equal(receiveCommands[0].input.MaxNumberOfMessages, 10);

  await poller.drain();
  assert.deepEqual(errorLogs, []);
});

test("drain releases messages returned by an abort race without starting handlers", async () => {
  const { logger } = createLogger();
  const receive = deferred<{ Messages: Array<Record<string, string>> }>();
  const releaseCommands: ChangeMessageVisibilityBatchCommand[] = [];
  let receiveStarted = false;
  let processCount = 0;
  const client = {
    send: async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        receiveStarted = true;
        return receive.promise;
      }
      if (command instanceof ChangeMessageVisibilityBatchCommand) {
        releaseCommands.push(command);
        return {};
      }
      return {};
    },
  } as unknown as SQSClient;
  const poller = new SqsPoller({
    client,
    queueUrl: "https://sqs.example.test/queue",
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 300,
    concurrency: 1,
    logger,
    processMessage: async () => {
      processCount += 1;
      return { kind: "acknowledge" };
    },
  });

  poller.start();
  await waitFor(() => receiveStarted);
  const drainPromise = poller.drain();
  receive.resolve({
    Messages: [
      {
        MessageId: "message-race",
        Body: "{}",
        ReceiptHandle: "receipt-race",
      },
    ],
  });
  await drainPromise;

  assert.equal(processCount, 0);
  assert.equal(releaseCommands.length, 1);
  assert.equal(releaseCommands[0].input.Entries?.[0]?.VisibilityTimeout, 0);
});

test("pause releases race-received messages and resume accepts new work", async () => {
  const { logger } = createLogger();
  const firstReceive = deferred<{ Messages: Array<Record<string, string>> }>();
  const releaseCommands: ChangeMessageVisibilityBatchCommand[] = [];
  let receiveCount = 0;
  let processCount = 0;
  const client = {
    send: async (command: unknown, options?: { abortSignal?: AbortSignal }) => {
      if (command instanceof ReceiveMessageCommand) {
        receiveCount += 1;
        if (receiveCount === 1) {
          return firstReceive.promise;
        }
        if (receiveCount === 2) {
          return {
            Messages: [
              {
                MessageId: "message-after-resume",
                Body: "{}",
                ReceiptHandle: "receipt-after-resume",
              },
            ],
          };
        }
        return pendingUntilAbort(options?.abortSignal);
      }
      if (command instanceof ChangeMessageVisibilityBatchCommand) {
        releaseCommands.push(command);
      }
      return {};
    },
  } as unknown as SQSClient;
  const poller = new SqsPoller({
    client,
    queueUrl: "https://sqs.example.test/queue",
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 300,
    concurrency: 1,
    logger,
    processMessage: async () => {
      processCount += 1;
      return { kind: "acknowledge" };
    },
    startHeartbeat: () => async () => undefined,
  });

  poller.start();
  await waitFor(() => receiveCount === 1);
  poller.pause();
  firstReceive.resolve({
    Messages: [
      {
        MessageId: "message-during-pause",
        Body: "{}",
        ReceiptHandle: "receipt-during-pause",
      },
    ],
  });
  await waitFor(() => releaseCommands.length === 1);
  assert.equal(processCount, 0);

  poller.resume();
  await waitFor(() => processCount === 1);
  await poller.drain();
});

test("receive failures use capped full jitter, reset after success, and ignore drain aborts", async () => {
  const { logger, errorLogs } = createLogger();
  const backoffDelays: number[] = [];
  let receiveCount = 0;
  const client = {
    send: async (command: unknown, options?: { abortSignal?: AbortSignal }) => {
      if (!(command instanceof ReceiveMessageCommand)) {
        return {};
      }

      receiveCount += 1;
      if (receiveCount === 1 || receiveCount === 2 || receiveCount === 4) {
        throw new Error(`receive failure ${receiveCount}`);
      }
      if (receiveCount === 3) {
        return {};
      }
      return pendingUntilAbort(options?.abortSignal);
    },
  } as unknown as SQSClient;
  const poller = new SqsPoller({
    client,
    queueUrl: "https://sqs.example.test/queue",
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 300,
    concurrency: 1,
    logger,
    processMessage: async () => ({ kind: "acknowledge" }),
    random: () => 0.5,
    sleep: async (ms) => {
      backoffDelays.push(ms);
    },
  });

  poller.start();
  await waitFor(() => receiveCount === 5);
  await poller.drain();

  assert.deepEqual(backoffDelays, [500, 1_000, 500]);
  assert.equal(errorLogs.length, 3);
  assert.equal(
    calculateReceiveBackoffMs(20, () => 1),
    30_000,
  );
});
