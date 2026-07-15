import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkerEnv } from "@taxtrack/shared";

import { createMistralClient } from "./mistralClient.ts";
import {
  BIR2307_DOCUMENT_ANNOTATION_FORMAT,
  NORMALIZER_RESPONSE_SCHEMA_NAME,
  SIGNATURE_BLOCK_DOCUMENT_ANNOTATION_FORMAT,
  SIGNATURE_BLOCK_RESPONSE_SCHEMA_NAME,
} from "./normalizerPostProcessing.ts";
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

function mockFetch(
  responseBody: Record<string, unknown> = { text: "BIR Form No. 2307" },
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    input: RequestInfo | URL;
    body: Record<string, unknown>;
  }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({
      input,
      body: JSON.parse(String(init?.body)),
    });

    return new Response(JSON.stringify(responseBody), {
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

test("createMistralClient sends one annotated OCR request for PDF payloads", async () => {
  const fetchMock = mockFetch({
    model: "mistral-document-ai-2512",
    document_annotation: {
      payeeName: "Therma Visayas, Inc.",
      signaturePresent: true,
      confidences: {
        payeeName: 0.98,
        signaturePresent: 0.9,
      },
    },
    usage_info: {
      pages_processed: 1,
    },
  });
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
      document_annotation_format?: Record<string, unknown>;
      document_annotation_prompt?: unknown;
      include_blocks?: unknown;
      include_image_base64?: unknown;
      confidence_scores_granularity?: unknown;
      table_format?: unknown;
    };

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(fetchMock.calls[0]?.input, config.apiUrl);
    assert.equal(body.model, "mistral-document-ai-2512");
    assert.equal(body.document?.type, "document_url");
    assert.match(
      String(body.document?.document_url),
      /^data:application\/pdf;base64,/u,
    );
    assert.deepEqual(
      body.document_annotation_format,
      BIR2307_DOCUMENT_ANNOTATION_FORMAT,
    );
    assert.equal(
      (body.document_annotation_format?.json_schema as Record<string, unknown>)
        .name,
      NORMALIZER_RESPONSE_SCHEMA_NAME,
    );
    assert.match(String(body.document_annotation_prompt), /signaturePresent/u);
    assert.equal(body.include_blocks, false);
    assert.equal(body.include_image_base64, false);
    assert.equal(body.confidence_scores_granularity, "page");
    assert.equal(body.table_format, undefined);
    assert.equal(result.metadata.provider, OCR_PROVIDER_AZURE_FOUNDRY);
    assert.equal(result.metadata.model, "mistral-document-ai-2512");
    assert.equal(result.metadata.responseModel, "mistral-document-ai-2512");
    assert.deepEqual(result.metadata.usageInfo, { pages_processed: 1 });
    assert.equal(typeof result.metadata.requestPayloadChars, "number");
    assert.deepEqual(result.raw.document_annotation, {
      payeeName: "Therma Visayas, Inc.",
      signaturePresent: true,
      confidences: {
        payeeName: 0.98,
        signaturePresent: 0.9,
      },
    });
  } finally {
    fetchMock.restore();
  }
});

test("createMistralClient sends lightweight zone OCR image requests", async () => {
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
      requestProfile: "zone_text",
    });

    const body = fetchMock.calls[0]?.body as {
      model?: unknown;
      document?: Record<string, unknown>;
      document_annotation_format?: unknown;
      document_annotation_prompt?: unknown;
      include_blocks?: unknown;
      include_image_base64?: unknown;
      confidence_scores_granularity?: unknown;
      table_format?: unknown;
    };

    assert.equal(fetchMock.calls[0]?.input, DEFAULT_MISTRAL_DIRECT_OCR_API_URL);
    assert.equal(body.model, DEFAULT_MISTRAL_DIRECT_OCR_MODEL);
    assert.equal(body.document?.type, "image_url");
    assert.match(String(body.document?.image_url), /^data:image\/png;base64,/u);
    assert.equal(body.include_blocks, false);
    assert.equal(body.include_image_base64, false);
    assert.equal(body.confidence_scores_granularity, "page");
    assert.equal(body.table_format, undefined);
    assert.equal(body.document_annotation_format, undefined);
    assert.equal(body.document_annotation_prompt, undefined);
  } finally {
    fetchMock.restore();
  }
});

test("createMistralClient sends signature-block annotation image requests", async () => {
  const fetchMock = mockFetch({
    model: "mistral-document-ai-2512",
    document_annotation: {
      printedName: "ENGR. JOSEPHUS PAULO C. MOTOS",
      signatoryTitle: null,
      signatoryTin: null,
      signaturePresent: null,
      signatureText: null,
      confidences: {
        printedName: 0.91,
        signatoryTitle: 0,
        signatoryTin: 0,
        signaturePresent: 0,
        signatureText: 0,
      },
      warnings: [],
    },
  });
  try {
    const config = resolveOcrConfig(
      workerEnv({
        OCR_PROVIDER: OCR_PROVIDER_MISTRAL_DIRECT,
        MISTRAL_DIRECT_OCR_API_KEY: "direct-key",
      }),
    );
    const client = createMistralClient(config);

    const result = await client.extract({
      sourceFileId: "source-1",
      revision: "v1-page-1-zone-signature_block",
      mimeType: "image/png",
      content: Buffer.from("png"),
      requestProfile: "signature_block_annotation",
    });

    const body = fetchMock.calls[0]?.body as {
      document_annotation_format?: Record<string, unknown>;
      document_annotation_prompt?: unknown;
    };

    assert.deepEqual(
      body.document_annotation_format,
      SIGNATURE_BLOCK_DOCUMENT_ANNOTATION_FORMAT,
    );
    assert.equal(
      (body.document_annotation_format?.json_schema as Record<string, unknown>)
        .name,
      SIGNATURE_BLOCK_RESPONSE_SCHEMA_NAME,
    );
    assert.match(
      String(body.document_annotation_prompt),
      /cropped payor signature block/u,
    );
    assert.doesNotMatch(
      String(body.document_annotation_prompt),
      /extracting structured data from a Philippine BIR Form 2307 Certificate/u,
    );
    assert.equal(result.metadata.requestProfile, "signature_block_annotation");
  } finally {
    fetchMock.restore();
  }
});
