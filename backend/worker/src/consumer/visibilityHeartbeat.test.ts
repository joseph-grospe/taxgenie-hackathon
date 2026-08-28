import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangeMessageVisibilityCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type { Logger } from "@taxgenie/shared";
import { startVisibilityHeartbeat } from "./visibilityHeartbeat.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(
  condition: () => boolean,
  message = "condition was not met",
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
}

function createLogger() {
  const warnLogs: Array<{ message: string; meta?: Record<string, unknown> }> =
    [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, meta) => warnLogs.push({ message, meta }),
    error: () => undefined,
    child: () => logger,
  };
  return { logger, warnLogs };
}

test("heartbeat extends visibility and stop cancels the next timer", async () => {
  const commands: ChangeMessageVisibilityCommand[] = [];
  const { logger } = createLogger();
  const client = {
    send: async (command: unknown) => {
      assert.ok(command instanceof ChangeMessageVisibilityCommand);
      commands.push(command);
      return {};
    },
  } as unknown as SQSClient;

  const stop = startVisibilityHeartbeat({
    client,
    queueUrl: "https://sqs.example.test/queue",
    receiptHandle: "receipt-1",
    visibilityTimeoutSeconds: 300,
    logger,
    messageId: "message-1",
    approximateReceiveCount: 2,
    heartbeatIntervalMs: 1,
  });

  await waitFor(() => commands.length === 1);
  await stop();
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  assert.equal(commands.length, 1);
  assert.equal(commands[0].input.VisibilityTimeout, 300);
});

test("heartbeat logs structured failures and retries after the retry delay", async () => {
  const { logger, warnLogs } = createLogger();
  let sendCount = 0;
  const client = {
    send: async () => {
      sendCount += 1;
      if (sendCount === 1) {
        const error = new Error("temporary SQS failure");
        error.name = "ServiceUnavailable";
        throw error;
      }
      return {};
    },
  } as unknown as SQSClient;

  const stop = startVisibilityHeartbeat({
    client,
    queueUrl: "https://sqs.example.test/queue",
    receiptHandle: "receipt-2",
    visibilityTimeoutSeconds: 300,
    logger,
    messageId: "message-2",
    approximateReceiveCount: 3,
    heartbeatIntervalMs: 1,
    retryDelayMs: 1,
  });

  await waitFor(() => sendCount === 2);
  await stop();

  assert.equal(warnLogs.length, 1);
  assert.equal(warnLogs[0].message, "SQS visibility heartbeat failed");
  assert.deepEqual(warnLogs[0].meta, {
    event: "sqs_visibility_heartbeat_failed",
    metricName: "SqsVisibilityHeartbeatFailures",
    metricValue: 1,
    messageId: "message-2",
    approximateReceiveCount: 3,
    consecutiveFailures: 1,
    visibilityTimeoutSeconds: 300,
    error: "temporary SQS failure",
    errorClass: "ServiceUnavailable",
  });
});

test("stopping before the first heartbeat cancels the timer", async () => {
  const { logger } = createLogger();
  let sendCount = 0;
  const client = {
    send: async () => {
      sendCount += 1;
      return {};
    },
  } as unknown as SQSClient;

  const stop = startVisibilityHeartbeat({
    client,
    queueUrl: "https://sqs.example.test/queue",
    receiptHandle: "receipt-3",
    visibilityTimeoutSeconds: 300,
    logger,
    heartbeatIntervalMs: 20,
  });

  await stop();
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.equal(sendCount, 0);
});

test("stop waits for an in-progress visibility update", async () => {
  const { logger } = createLogger();
  const sendResult = deferred<object>();
  let sendStarted = false;
  const client = {
    send: async () => {
      sendStarted = true;
      return sendResult.promise;
    },
  } as unknown as SQSClient;

  const stop = startVisibilityHeartbeat({
    client,
    queueUrl: "https://sqs.example.test/queue",
    receiptHandle: "receipt-4",
    visibilityTimeoutSeconds: 300,
    logger,
    heartbeatIntervalMs: 1,
  });

  await waitFor(() => sendStarted);
  let stopCompleted = false;
  const stopPromise = stop().then(() => {
    stopCompleted = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopCompleted, false);

  sendResult.resolve({});
  await stopPromise;
  assert.equal(stopCompleted, true);
});
