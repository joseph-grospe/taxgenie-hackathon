import assert from "node:assert/strict";
import test from "node:test";

import {
  AZURE_NORMALIZER_RESPONSE_FORMAT,
  AZURE_NORMALIZER_SYSTEM_PROMPT,
  buildNormalizerPromptPayload,
  createAzureNormalizerClient,
  DEFAULT_AZURE_OPENAI_API_VERSION,
  NORMALIZER_RESPONSE_SCHEMA_NAME,
  NORMALIZER_RESPONSE_SCHEMA_VERSION,
} from "./azureNormalizerClient.ts";

function createTestExtraction(raw: Record<string, unknown> = {}) {
  return {
    provider: "mistral-ocr",
    startedAt: "2026-05-26T14:17:26.917Z",
    finishedAt: "2026-05-26T14:17:30.548Z",
    durationMs: 3631,
    raw,
    metadata: {},
  };
}

test("Azure normalizer prompt requires canonical TIN output", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /TIN fields/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /digits only/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Preserve leading zeroes/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Do not infer, pad, truncate/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /item 2 and item 6 TIN rows/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /two digits ending in "1"/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /merge adjacent boxed tokens/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /005031663000/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /9, 12, 13, or 14 digits/u);
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

test("Azure normalizer prompt requests month of quarter without inferring it", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /monthOfQuarter/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /first/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /second/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /third/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /taxBase placement/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Do not infer this value/u);
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
                    monthOfQuarter: " THIRD ",
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
                      payeeTin: null,
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
  assert.equal(result.fields.monthOfQuarter, "third");
  assert.equal(result.fields.signaturePresent, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.fields, "signatureText"),
    false,
  );
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(
    request.response_format,
    AZURE_NORMALIZER_RESPONSE_FORMAT,
  );
  const responseFormat = request.response_format as Record<string, unknown>;
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(
    (responseFormat.json_schema as Record<string, unknown>).name,
    NORMALIZER_RESPONSE_SCHEMA_NAME,
  );
  assert.equal(
    (responseFormat.json_schema as Record<string, unknown>).strict,
    true,
  );
  const schema = (responseFormat.json_schema as Record<string, unknown>)
    .schema as Record<string, unknown>;
  assert.equal(schema.additionalProperties, false);
  assert.equal(Array.isArray(schema.required), true);
  assert.deepEqual(
    (schema.required as string[]).includes("confidences"),
    true,
  );
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.confidences.additionalProperties, false);
  assert.equal(Array.isArray(properties.confidences.required), true);
  assert.deepEqual(properties.monthOfQuarter.enum, [
    "first",
    "second",
    "third",
    null,
  ]);
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
  assert.equal(
    normalizerPayload.normalizerApiVersion,
    DEFAULT_AZURE_OPENAI_API_VERSION,
  );
  assert.equal(normalizerPayload.normalizerResponseFormat, "json_schema");
  assert.equal(
    normalizerPayload.normalizerResponseSchemaName,
    NORMALIZER_RESPONSE_SCHEMA_NAME,
  );
  assert.equal(
    normalizerPayload.normalizerResponseSchemaVersion,
    NORMALIZER_RESPONSE_SCHEMA_VERSION,
  );
  assert.equal(
    normalizerPayload.normalizerPromptPayloadChars,
    (userMessage?.content as string).length,
  );
  assert.equal(normalizerPayload.promptTokens, 321);
  assert.equal(normalizerPayload.completionTokens, 123);
  assert.equal(normalizerPayload.totalTokens, 444);
  assert.equal("metadata" in normalizerPayload, false);
  assert.deepEqual(result.fields.confidenceMap, {
    payeeName: 0.98,
  });
});

test("Azure normalizer rejects old Azure API versions before request", async () => {
  let requestCount = 0;
  const client = {
    chat: {
      completions: {
        async create() {
          requestCount += 1;
          return {
            choices: [],
          };
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
    apiVersion: "2024-04-01-preview",
    client,
  });

  await assert.rejects(
    () =>
      normalizer.normalize({
        sourceFileId: "source-1",
        revision: "rev-1-page-1",
        extraction: createTestExtraction(),
      }),
    /Structured Outputs require API version 2024-08-01-preview or later/u,
  );
  assert.equal(requestCount, 0);
});

test("Azure normalizer wraps json_schema request errors", async () => {
  const client = {
    chat: {
      completions: {
        async create() {
          throw new Error("Invalid parameter: response_format json_schema");
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
    deploymentName: "gpt-4.1",
    client,
  });

  await assert.rejects(
    () =>
      normalizer.normalize({
        sourceFileId: "source-1",
        revision: "rev-1-page-1",
        extraction: createTestExtraction(),
      }),
    /Structured Outputs request failed/u,
  );
});

for (const scenario of [
  {
    name: "refusal",
    response: {
      choices: [
        {
          message: {
            refusal: "Cannot process this document",
          },
        },
      ],
    },
    match: /refused to normalize/u,
  },
  {
    name: "empty content",
    response: {
      choices: [
        {
          message: {
            content: "",
          },
        },
      ],
    },
    match: /empty structured content/u,
  },
  {
    name: "length-truncated completion",
    response: {
      choices: [
        {
          finish_reason: "length",
          message: {
            content: "{}",
          },
        },
      ],
    },
    match: /truncated before completion/u,
  },
] as const) {
  test(`Azure normalizer rejects ${scenario.name}`, async () => {
    const client = {
      chat: {
        completions: {
          async create() {
            return scenario.response;
          },
        },
      },
    };

    const normalizer = createAzureNormalizerClient({
      apiKey: "test-key",
      endpoint: "https://example.test",
      deploymentName: "gpt-4.1",
      client,
    });

    await assert.rejects(
      () =>
        normalizer.normalize({
          sourceFileId: "source-1",
          revision: "rev-1-page-1",
          extraction: createTestExtraction(),
        }),
      scenario.match,
    );
  });
}

test("Azure normalizer derives month of quarter from tax base table placement", async () => {
  const client = {
    chat: {
      completions: {
        async create() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    periodStart: "01-01-2026",
                    periodEnd: "03-31-2026",
                    monthOfQuarter: null,
                    atcCode: "WC160",
                    taxBase: "9,131.50",
                    taxWithheld: "182.63",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
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
            markdown: `
|  Income Payments Subject to Expanded Withholding Tax | ATC | AMOUNT OF INCOME PAYMENTS |   |   |   |   |   |   |   | Tax Withheld for the Quarter  |   |   |
|   |   |  1st Month of the Quarter | 2nd Month of the Quarter |   | 3rd Month of the Quarter |   | Total  |   |   |   |   |   |
|  INCOME PAYMENT MADE BY TOP |   | WC160 | 0.00 | 9,131.50 |   | 0.00 |   | 9,131.50 |   |   | 182.63  |   |
`,
          },
        ],
      },
      metadata: {},
    },
  });

  assert.equal(result.fields.taxBase, 9131.5);
  assert.equal(result.fields.monthOfQuarter, "second");
});

test("Azure normalizer ignores invalid month of quarter values", async () => {
  const client = {
    chat: {
      completions: {
        async create() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    periodEnd: "09-30-2026",
                    monthOfQuarter: "fourth",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
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
      raw: {},
      metadata: {},
    },
  });

  assert.equal(result.fields.periodEnd, "09-30-2026");
  assert.equal(result.fields.monthOfQuarter, undefined);
});

test("Azure normalizer prefers boxed TIN rows over valid-length model output", async () => {
  const client = {
    chat: {
      completions: {
        async create() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    payeeName: "Therma Visayas, Inc. (TVI)",
                    payeeTin: "105013161610101",
                    payorName: "Camiguin Electric Cooperative, Inc.",
                    payorTin: "001516172000",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
    client,
  });

  const result = await normalizer.normalize({
    sourceFileId: "source-1",
    revision: "rev-1-page-1",
    extraction: {
      provider: "mistral-ocr",
      startedAt: "2026-06-22T00:00:00.000Z",
      finishedAt: "2026-06-22T00:00:01.000Z",
      durationMs: 1000,
      raw: {
        pages: [
          {
            markdown: `
| 2 Taxpayer Identification Number (TIN) |   | 01 01 5 | 01 31 1 | 61 61 3 | 01 01 01 |  |   |
| 3 Payee's Name |
| Therma Visayas, Inc. (TVI) |
| 6 Taxpayer Identification Number (TIN) |   | 01 01 0 | 51 61 9 | 01 71 2 | 01 01 01 |  |   |
| 7 Payor's Name |
| Camiguin Electric Cooperative, Inc. |
`,
          },
        ],
      },
      metadata: {},
    },
  });

  assert.equal(result.fields.payeeTin, "005031663000");
  assert.equal(result.fields.payorTin, "000569072000");
});

test("Azure normalizer decodes merged boxed TIN cells from zone fallback", async () => {
  const client = {
    chat: {
      completions: {
        async create() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    payorName: "Camiguin Electric Cooperative, Inc.",
                    payorTin: "001516172000",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };

  const normalizer = createAzureNormalizerClient({
    apiKey: "test-key",
    endpoint: "https://example.test",
    client,
  });

  const result = await normalizer.normalize({
    sourceFileId: "source-1",
    revision: "rev-1-page-1",
    extraction: {
      provider: "mistral-ocr",
      startedAt: "2026-06-22T00:00:00.000Z",
      finishedAt: "2026-06-22T00:00:01.000Z",
      durationMs: 1000,
      raw: {
        pages: [
          {
            markdown: `
| 7 Payor's Name |
| Camiguin Electric Cooperative, Inc. |
`,
          },
        ],
        zoneOcrFallbackText: [
          {
            zoneId: "payee_payor_info",
            text: "|  6 Taxpayer Identification Number (TIN) | 010 0 | - | 516 9 | - | 017 2 | - | 010 10 | | |   |",
          },
        ],
      },
      metadata: {
        zoneOcrFallback: {
          status: "completed",
          triggeredZones: ["payee_payor_info"],
        },
      },
    },
  });

  assert.equal(result.fields.payorTin, "000569072000");
});
