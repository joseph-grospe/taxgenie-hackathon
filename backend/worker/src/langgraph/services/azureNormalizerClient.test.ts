import assert from "node:assert/strict";
import test from "node:test";

import {
  AZURE_NORMALIZER_SYSTEM_PROMPT,
  buildNormalizerPromptPayload,
  createAzureNormalizerClient,
} from "./azureNormalizerClient.ts";

test("Azure normalizer prompt requires canonical TIN output", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /TIN fields/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /digits only/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Preserve leading zeroes/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Do not infer, pad, truncate/u);
});

test("Azure normalizer prompt treats zone OCR as supplemental", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /ocr\.main/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /targeted high-resolution OCR/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /blocks\[\]\.content/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /correct ocr\.main fields/u);
  assert.match(
    AZURE_NORMALIZER_SYSTEM_PROMPT,
    /very long repeated digit runs/u,
  );
});

test("buildNormalizerPromptPayload separates main OCR and zone fallback evidence", () => {
  const payload = buildNormalizerPromptPayload({
    sourceFileId: "source-1",
    revision: "rev-1-page-1",
    extraction: {
      provider: "mistral-ocr",
      startedAt: "2026-05-26T14:17:26.917Z",
      finishedAt: "2026-05-26T14:17:30.548Z",
      durationMs: 3631,
      parsedText:
        "main full page text\n\n[Zone OCR fallback: payee_payor_info]\nzone text",
      raw: {
        pages: [
          {
            markdown:
              "Part I - Payee Information TIN 2 6 7 8 9 0 1 0 7 0 1 0 6 6 6 6",
          },
        ],
        zoneOcrFallbackText: [
          {
            zoneId: "payee_payor_info",
            text: "TIN 2 6 7 0 9 0 0 7 0 0 0 0 0 0",
            markdown: "| TIN | 2 6 7 0 9 0 0 7 0 0 0 0 0 0 |",
          },
          {
            zoneId: "signature_block",
            text: "Printed Name JUAN DELA CRUZ",
          },
        ],
      },
      metadata: {
        requestStatus: "ok",
        massiveDebugPayload: "debug-value-that-should-not-enter-the-prompt",
        zoneOcrFallback: {
          status: "completed",
          triggeredZones: ["payee_payor_info"],
        },
      },
    },
  });

  const promptJson = JSON.stringify(payload);
  const payloadRecord = payload as Record<string, unknown>;
  const main = payload.ocr.main as Record<string, unknown>;
  const zoneFallback = payload.ocr.zoneFallback as Record<string, unknown>;

  assert.equal(payload.payloadSchemaVersion, 3);
  assert.equal("source" in payloadRecord, false);
  assert.equal("extraction" in payloadRecord, false);
  assert.equal("role" in main, false);
  assert.equal("metadata" in zoneFallback, false);
  assert.doesNotMatch(
    promptJson,
    /debug-value-that-should-not-enter-the-prompt/u,
  );
  assert.doesNotMatch(promptJson, /requestStatus/u);
  assert.match(payload.ocr.main.text, /Payee Information/u);
  assert.doesNotMatch(payload.ocr.main.text, /Zone OCR fallback/u);
  assert.equal(payload.ocr.zoneFallback.status, "completed");
  assert.deepEqual(payload.ocr.zoneFallback.blocks, [
    {
      zoneId: "payee_payor_info",
      content: "| TIN | 2 6 7 0 9 0 0 7 0 0 0 0 0 0 |",
    },
    {
      zoneId: "signature_block",
      content: "Printed Name JUAN DELA CRUZ",
    },
  ]);
});

test("Azure normalizer records token usage in audit payload", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    chat: {
      completions: {
        async create(body: Record<string, unknown>) {
          requests.push(body);
          return {
            model: "gpt-4.1-2025-04-14",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    periodStart: "08-01-2025",
                    periodEnd: "08-31-2025",
                    payeeName: "THERMA MARINE, INC.",
                    payeeTin: "26709007000000",
                    payorName: "SAMPLE PAYOR CORP.",
                    payorTin: "123456789000",
                    atcCode: "WC100",
                    taxBase: "1000.00",
                    taxWithheld: "20.00",
                    signaturePresent: true,
                    signatureText: "legacy model text",
                    confidences: {
                      payeeName: 0.98,
                    },
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 321,
              completion_tokens: 123,
              total_tokens: 444,
            },
          };
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
    deploymentName: "gpt-4.1",
    apiVersion: "2024-04-01-preview",
    client,
  });

  const result = await normalizer.normalize({
    sourceFileId: "source-1",
    revision: "rev-1-page-1",
    extraction: {
      provider: "mistral-ocr",
      startedAt: "2026-05-26T14:17:26.917Z",
      finishedAt: "2026-05-26T14:17:30.548Z",
      durationMs: 3631,
      raw: {
        pages: [
          {
            markdown: "Part I - Payee Information THERMA MARINE, INC.",
          },
        ],
      },
      metadata: {},
    },
  });

  assert.equal(result.fields.periodStart, "08-01-2025");
  assert.equal(result.fields.periodEnd, "08-31-2025");
  assert.equal(result.fields.periodCovered, "08-01-2025 to 08-31-2025");
  assert.equal(result.fields.signaturePresent, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.fields, "signatureText"),
    false,
  );
  assert.equal(requests.length, 1);
  const request = requests[0];
  const messages = request.messages as Array<Record<string, unknown>>;
  const userMessage = messages.find((message) => message.role === "user");
  assert.equal(typeof userMessage?.content, "string");
  assert.doesNotMatch(AZURE_NORMALIZER_SYSTEM_PROMPT, /signatureText/u);
  assert.doesNotMatch(AZURE_NORMALIZER_SYSTEM_PROMPT, /signature text/iu);

  const normalizerPayload = result.fields.normalizerPayload as Record<
    string,
    unknown
  >;
  assert.equal(normalizerPayload.payloadSchemaVersion, 3);
  assert.equal(normalizerPayload.sourceFileId, "source-1");
  assert.equal(normalizerPayload.revision, "rev-1-page-1");
  assert.equal(normalizerPayload.normalizerProvider, "azure-openai");
  assert.equal(normalizerPayload.normalizerDeployment, "gpt-4.1");
  assert.equal(normalizerPayload.normalizerResponseModel, "gpt-4.1-2025-04-14");
  assert.equal(normalizerPayload.normalizerApiVersion, "2024-04-01-preview");
  assert.equal(
    normalizerPayload.normalizerPromptPayloadChars,
    (userMessage?.content as string).length,
  );
  assert.equal(normalizerPayload.promptTokens, 321);
  assert.equal(normalizerPayload.completionTokens, 123);
  assert.equal(normalizerPayload.totalTokens, 444);
  assert.equal("metadata" in normalizerPayload, false);
});
