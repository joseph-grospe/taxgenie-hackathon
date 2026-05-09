import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkerEnv } from "@taxtrack/shared";

import { createMistralClient } from "./mistralClient.ts";
import {
  DEFAULT_MISTRAL_DIRECT_OCR_API_URL,
  DEFAULT_MISTRAL_DIRECT_OCR_MODEL,
  OCR_PROVIDER_AZURE_FOUNDRY,
  OCR_PROVIDER_MISTRAL_DIRECT,
  resolveOcrConfig,
} from "./ocrConfig.ts";

function workerEnv(overrides: Record<string, string | undefined>) {
  return loadWorkerEnv({
    AWS_REGION: "ap-southeast-1",
    SQS_QUEUE_URL: "https://sqs.ap-southeast-1.amazonaws.com/123/queue",
    S3_BUCKET_NAME: "taxtrack-test",
    ADMIN_TOKEN: "admin-token",
    ...overrides,
  });
}

function mockFetch() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({
      input,
      body: JSON.parse(String(init?.body)),
    });

    return new Response(JSON.stringify({ text: "BIR Form No. 2307" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("createMistralClient sends Azure Foundry model and PDF document_url payloads", async () => {
  const fetchMock = mockFetch();
  try {
    const config = resolveOcrConfig(
      workerEnv({
        AZURE_FOUNDRY_OCR_API_URL:
          "https://taxtrack.cognitiveservices.azure.com/providers/mistral/azure/ocr",
        AZURE_FOUNDRY_OCR_API_KEY: "azure-key",
        AZURE_FOUNDRY_OCR_MODEL: "mistral-document-ai-2512",
      }),
    );
    const client = createMistralClient(config);

    const result = await client.extract({
      sourceFileId: "source-1",
      revision: "v1-page-1",
      mimeType: "application/pdf",
      content: Buffer.from("%PDF"),
    });

    const body = fetchMock.calls[0]?.body as {
      model?: unknown;
      document?: Record<string, unknown>;
    };

    assert.equal(fetchMock.calls[0]?.input, config.apiUrl);
    assert.equal(body.model, "mistral-document-ai-2512");
    assert.equal(body.document?.type, "document_url");
    assert.match(String(body.document?.document_url), /^data:application\/pdf;base64,/u);
    assert.equal(result.metadata.provider, OCR_PROVIDER_AZURE_FOUNDRY);
    assert.equal(result.metadata.model, "mistral-document-ai-2512");
  } finally {
    fetchMock.restore();
  }
});

test("createMistralClient sends Mistral direct defaults and image_url payloads", async () => {
  const fetchMock = mockFetch();
  try {
    const config = resolveOcrConfig(
      workerEnv({
        OCR_PROVIDER: OCR_PROVIDER_MISTRAL_DIRECT,
        MISTRAL_DIRECT_OCR_API_KEY: "direct-key",
      }),
    );
    const client = createMistralClient(config);

    await client.extract({
      sourceFileId: "source-1",
      revision: "v1-page-1-zone-payee_payor_info",
      mimeType: "image/png",
      content: Buffer.from("png"),
    });

    const body = fetchMock.calls[0]?.body as {
      model?: unknown;
      document?: Record<string, unknown>;
    };

    assert.equal(fetchMock.calls[0]?.input, DEFAULT_MISTRAL_DIRECT_OCR_API_URL);
    assert.equal(body.model, DEFAULT_MISTRAL_DIRECT_OCR_MODEL);
    assert.equal(body.document?.type, "image_url");
    assert.match(String(body.document?.image_url), /^data:image\/png;base64,/u);
  } finally {
    fetchMock.restore();
  }
});
