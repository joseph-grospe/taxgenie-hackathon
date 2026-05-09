import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkerEnv, type WorkerEnv } from "@taxtrack/shared";

import {
  DEFAULT_AZURE_FOUNDRY_OCR_MODEL,
  DEFAULT_MISTRAL_DIRECT_OCR_API_URL,
  DEFAULT_MISTRAL_DIRECT_OCR_MODEL,
  OCR_PROVIDER_AZURE_FOUNDRY,
  OCR_PROVIDER_MISTRAL_DIRECT,
  resolveOcrConfig,
} from "./ocrConfig.ts";

function workerEnv(overrides: Record<string, string | undefined>): WorkerEnv {
  return loadWorkerEnv({
    AWS_REGION: "ap-southeast-1",
    SQS_QUEUE_URL: "https://sqs.ap-southeast-1.amazonaws.com/123/queue",
    S3_BUCKET_NAME: "taxtrack-test",
    ADMIN_TOKEN: "admin-token",
    ...overrides,
  });
}

test("resolveOcrConfig defaults to Azure Foundry OCR 2512", () => {
  const config = resolveOcrConfig(
    workerEnv({
      AZURE_FOUNDRY_OCR_API_URL:
        "https://taxtrack.cognitiveservices.azure.com/providers/mistral/azure/ocr",
      AZURE_FOUNDRY_OCR_API_KEY: "azure-key",
    }),
  );

  assert.equal(config.provider, OCR_PROVIDER_AZURE_FOUNDRY);
  assert.equal(config.model, DEFAULT_AZURE_FOUNDRY_OCR_MODEL);
  assert.equal(config.apiKey, "azure-key");
  assert.equal(config.timeoutMs, 180000);
});

test("resolveOcrConfig uses direct Mistral defaults when selected", () => {
  const config = resolveOcrConfig(
    workerEnv({
      OCR_PROVIDER: OCR_PROVIDER_MISTRAL_DIRECT,
      MISTRAL_DIRECT_OCR_API_KEY: "direct-key",
    }),
  );

  assert.equal(config.provider, OCR_PROVIDER_MISTRAL_DIRECT);
  assert.equal(config.apiUrl, DEFAULT_MISTRAL_DIRECT_OCR_API_URL);
  assert.equal(config.model, DEFAULT_MISTRAL_DIRECT_OCR_MODEL);
  assert.equal(config.apiKey, "direct-key");
});

test("resolveOcrConfig preserves legacy Azure OCR environment variables", () => {
  const config = resolveOcrConfig(
    workerEnv({
      MISTRAL_API_URL:
        "https://legacy.cognitiveservices.azure.com/providers/mistral/azure/ocr",
      AZURE_API_KEY: "legacy-azure-key",
      MISTRAL_MODEL: "legacy-ocr-model",
      MISTRAL_TIMEOUT_MS: "240000",
    }),
  );

  assert.equal(config.provider, OCR_PROVIDER_AZURE_FOUNDRY);
  assert.equal(config.apiUrl, "https://legacy.cognitiveservices.azure.com/providers/mistral/azure/ocr");
  assert.equal(config.apiKey, "legacy-azure-key");
  assert.equal(config.model, "legacy-ocr-model");
  assert.equal(config.timeoutMs, 240000);
});

test("resolveOcrConfig gives OCR_TIMEOUT_MS precedence", () => {
  const config = resolveOcrConfig(
    workerEnv({
      AZURE_FOUNDRY_OCR_API_URL:
        "https://taxtrack.cognitiveservices.azure.com/providers/mistral/azure/ocr",
      AZURE_FOUNDRY_OCR_API_KEY: "azure-key",
      OCR_TIMEOUT_MS: "90000",
      MISTRAL_TIMEOUT_MS: "240000",
    }),
  );

  assert.equal(config.timeoutMs, 90000);
});

test("resolveOcrConfig fails clearly when active provider lacks required config", () => {
  assert.throws(
    () =>
      resolveOcrConfig(
        workerEnv({
          AZURE_FOUNDRY_OCR_API_URL:
            "https://taxtrack.cognitiveservices.azure.com/providers/mistral/azure/ocr",
        }),
      ),
    /azure_foundry requires AZURE_FOUNDRY_OCR_API_KEY/u,
  );

  assert.throws(
    () =>
      resolveOcrConfig(
        workerEnv({
          AZURE_FOUNDRY_OCR_API_KEY: "azure-key",
        }),
      ),
    /azure_foundry requires AZURE_FOUNDRY_OCR_API_URL/u,
  );

  assert.throws(
    () =>
      resolveOcrConfig(
        workerEnv({
          OCR_PROVIDER: OCR_PROVIDER_MISTRAL_DIRECT,
        }),
      ),
    /mistral_direct requires MISTRAL_DIRECT_OCR_API_KEY/u,
  );
});
