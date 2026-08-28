import assert from "node:assert/strict";
import test from "node:test";

import type { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { loadWorkerEnv, type Logger } from "@taxgenie/shared";
import type { Client, ClientConfig } from "langsmith";
import {
  createLangSmithTracing,
  LANGSMITH_APAC_ENDPOINT,
  redactTraceData,
} from "./langsmith.ts";

const logEntries: Array<{ level: string; message: string }> = [];
const logger: Logger = {
  debug: (message) => logEntries.push({ level: "debug", message }),
  info: (message) => logEntries.push({ level: "info", message }),
  warn: (message) => logEntries.push({ level: "warn", message }),
  error: (message) => logEntries.push({ level: "error", message }),
  child: () => logger,
};

function workerEnv(overrides: Record<string, string> = {}) {
  return loadWorkerEnv({
    NODE_ENV: "test",
    AWS_REGION: "ap-southeast-1",
    SQS_QUEUE_URL: "https://sqs.example.test/queue",
    S3_BUCKET_NAME: "test-bucket",
    ADMIN_TOKEN: "test-admin-token",
    GEMINI_API_KEY: "test-key",
    ...overrides,
  });
}

test("trace redaction removes nested certificate data and preserves telemetry", () => {
  const masked = redactTraceData({
    jobId: "job-safe",
    eventId: "event-safe",
    sourceFileId: "source-safe",
    revision: "revision-safe",
    status: "success",
    durationMs: 250,
    sourceContentBase64: "private-pdf",
    attachment: Buffer.from("private-buffer"),
    extractionResult: {
      certificates: [
        { payor: { tin: "123", registeredAddress: "private address" } },
      ],
      secretValue: "private extraction",
    },
    extractionMetadata: {
      metadata: { totalTokenCount: 100, latencyMs: 250 },
    },
    nestedItems: [
      {
        payeeTin: "987654321000",
        registeredAddress: "nested private address",
        pdfContentBase64: "nested-private-pdf",
        telemetry: { retryCount: 1, status: "success" },
      },
    ],
  });

  const serialized = JSON.stringify(masked);
  assert.doesNotMatch(
    serialized,
    /private-pdf|private-buffer|private extraction|private address|987654321000|"123"/u,
  );
  assert.match(serialized, /REDACTED/u);
  assert.match(serialized, /totalTokenCount/u);
  assert.match(serialized, /latencyMs/u);
  assert.match(serialized, /job-safe|event-safe|source-safe|revision-safe/u);
  assert.match(serialized, /retryCount|success/u);
});

test("tracing is disabled by default and when the API key is missing", () => {
  logEntries.length = 0;
  const defaultTracing = createLangSmithTracing(workerEnv(), logger);
  const missingKeyTracing = createLangSmithTracing(
    workerEnv({ TAXGENIE_LANGSMITH_ENABLED: "true" }),
    logger,
  );

  assert.equal(defaultTracing.enabled, false);
  assert.deepEqual(defaultTracing.callbacks, []);
  assert.equal(missingKeyTracing.enabled, false);
  assert.deepEqual(missingKeyTracing.callbacks, []);
  assert.equal(
    logEntries.some((entry) => entry.message.includes("API_KEY is missing")),
    true,
  );
});

test("tracing uses the APAC endpoint, project, redaction, and flushes buffers", async () => {
  let clientConfig: ClientConfig | undefined;
  let tracerFields: Record<string, unknown> | undefined;
  const flushOrder: string[] = [];
  const fakeClient = {
    flush: async () => {
      flushOrder.push("client-flush");
    },
    awaitPendingTraceBatches: async () => {
      flushOrder.push("pending-batches");
    },
  } as unknown as Client;
  const fakeTracer = { name: "test-langsmith-tracer" } as LangChainTracer;

  const tracing = createLangSmithTracing(
    workerEnv({
      TAXGENIE_LANGSMITH_ENABLED: "true",
      LANGSMITH_API_KEY: "test-service-key",
      LANGSMITH_PROJECT: "taxgenie-uat",
    }),
    logger,
    {
      createClient: (config) => {
        clientConfig = config;
        return fakeClient;
      },
      createTracer: (fields) => {
        tracerFields = fields as unknown as Record<string, unknown>;
        return fakeTracer;
      },
      awaitCallbacks: async () => {
        flushOrder.push("callbacks");
      },
    },
  );

  assert.equal(tracing.enabled, true);
  assert.deepEqual(tracing.callbacks, [fakeTracer]);
  assert.equal(clientConfig?.apiUrl, LANGSMITH_APAC_ENDPOINT);
  assert.equal(clientConfig?.apiKey, "test-service-key");
  assert.equal(tracerFields?.projectName, "taxgenie-uat");
  assert.equal(tracerFields?.raiseError, false);
  assert.equal(
    JSON.stringify(
      await (clientConfig?.hideInputs as (value: Record<string, unknown>) =>
        | Record<string, unknown>
        | Promise<Record<string, unknown>>)({ payorTin: "123" }),
    ).includes("123"),
    false,
  );

  await tracing.flush();
  assert.deepEqual(flushOrder, [
    "callbacks",
    "client-flush",
    "pending-batches",
  ]);
});

test("tracer initialization failures disable tracing without escaping", () => {
  logEntries.length = 0;
  const tracing = createLangSmithTracing(
    workerEnv({
      TAXGENIE_LANGSMITH_ENABLED: "true",
      LANGSMITH_API_KEY: "test-service-key",
    }),
    logger,
    {
      createClient: () => {
        throw new Error("invalid client configuration");
      },
    },
  );

  assert.equal(tracing.enabled, false);
  assert.deepEqual(tracing.callbacks, []);
  assert.equal(
    logEntries.some(
      (entry) => entry.message === "LangSmith tracing initialization failed",
    ),
    true,
  );
});

test("flush failures are logged and do not escape shutdown", async () => {
  logEntries.length = 0;
  const fakeClient = {
    flush: async () => {
      throw new Error("network unavailable");
    },
    awaitPendingTraceBatches: async () => undefined,
  } as unknown as Client;

  const tracing = createLangSmithTracing(
    workerEnv({
      TAXGENIE_LANGSMITH_ENABLED: "true",
      LANGSMITH_API_KEY: "test-service-key",
    }),
    logger,
    {
      createClient: () => fakeClient,
      createTracer: () => ({ name: "tracer" }) as LangChainTracer,
      awaitCallbacks: async () => undefined,
    },
  );

  await tracing.flush();
  assert.equal(
    logEntries.some((entry) => entry.message === "LangSmith trace flush failed"),
    true,
  );
});
