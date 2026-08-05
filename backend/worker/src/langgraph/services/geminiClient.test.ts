import assert from "node:assert/strict";
import test from "node:test";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";

import { createGeminiClient, GeminiExtractionError } from "./geminiClient.ts";

const extractionResult = {
  schemaVersion: 1 as const,
  classification: {
    documentType: "BIR_2307" as const,
    confidence: 0.99,
    pageCount: 2,
  },
  certificates: [
    {
      certificateKey: "certificate-1",
      pageNumbers: [1, 2],
      period: {
        start: "2026-04-01",
        end: "2026-06-30",
        monthOfQuarter: "first" as const,
      },
      payee: {
        name: "THERMA VISAYAS, INC.",
        tin: "00503166300000",
        address: "CEBU CITY",
        zip: "6000",
      },
      payor: {
        name: "DAGUPAN ELECTRIC CORPORATION",
        tin: "0002025240000",
        address: "DAGUPAN CITY",
        zip: "2400",
      },
      taxRows: [
        {
          lineNumber: 1,
          pageNumber: 2,
          atcCode: "WC160",
          description: "Payment made by top 10,000 corporations",
          monthlyAmounts: {
            first: "116833.55",
            second: null,
            third: null,
          },
          taxBase: "116833.55",
          taxRate: "0.0200",
          taxWithheld: "2336.67",
        },
      ],
      primaryAtcCode: "WC160",
      totals: {
        taxBase: "116833.55",
        taxWithheld: "2336.67",
      },
      signer: {
        printedName: "LILIAN D. SARALDE",
        title: "Finance Manager",
        tin: "901327847000",
        companyName: null,
        signature: {
          present: true,
          confidence: 0.93,
          pageNumber: 2,
          source: "gemini" as const,
        },
      },
      confidence: {
        period: 0.99,
        payee: 0.98,
        payor: 0.98,
        taxRows: 0.96,
        signer: 0.91,
      },
      evidence: {
        period: {
          pageNumber: 1,
          section: "Item 1",
          excerpt: "For the Period From 04 01 2026 To 06 30 2026",
          source: "visual_and_embedded_text" as const,
        },
      },
      warnings: [],
    },
  ],
};

function response(
  value: unknown,
  overrides: Partial<GenerateContentResponse> = {},
): GenerateContentResponse {
  return {
    candidates: [{ content: { role: "model", parts: [{ text: "json" }] } }],
    text: JSON.stringify(value),
    modelVersion: "gemini-3-flash-preview-20260701",
    usageMetadata: {
      promptTokenCount: 110,
      candidatesTokenCount: 70,
      thoughtsTokenCount: 30,
      totalTokenCount: 210,
    },
    ...overrides,
  } as GenerateContentResponse;
}

function config() {
  return {
    provider: "gemini" as const,
    apiKey: "test-key",
    model: "gemini-3-flash-preview",
    timeoutMs: 180_000,
    thinkingLevel: "high" as const,
    mediaResolution: "medium" as const,
    maxRetries: 2,
  };
}

test("Gemini sends one inline whole PDF using strict agentic structured output", async () => {
  const requests: GenerateContentParameters[] = [];
  const client = createGeminiClient(config(), {
    generateContent: async (parameters) => {
      requests.push(parameters);
      return response(extractionResult);
    },
    now: () => 1_000,
  });

  const pdf = Buffer.from("complete-multi-page-pdf");
  const result = await client.extract({
    sourceFileId: "source-1",
    revision: "revision-1",
    mimeType: "application/pdf",
    content: pdf,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.model, "gemini-3-flash-preview");
  const contents = requests[0]?.contents as Array<{
    parts: Array<{
      text?: string;
      inlineData?: { mimeType?: string; data?: string };
    }>;
  }>;
  assert.match(contents[0]?.parts[0]?.text ?? "", /complete uploaded PDF/iu);
  assert.doesNotMatch(
    contents[0]?.parts[0]?.text ?? "",
    /complete visible text/iu,
  );
  assert.equal(contents[0]?.parts[1]?.inlineData?.data, pdf.toString("base64"));
  assert.equal(contents[0]?.parts[1]?.inlineData?.mimeType, "application/pdf");
  assert.equal(requests[0]?.config?.temperature, undefined);
  assert.equal(requests[0]?.config?.thinkingConfig?.thinkingLevel, "HIGH");
  assert.equal(requests[0]?.config?.thinkingConfig?.includeThoughts, false);
  assert.equal(requests[0]?.config?.mediaResolution, "MEDIA_RESOLUTION_MEDIUM");
  assert.equal(requests[0]?.config?.responseMimeType, "application/json");

  const schema = requests[0]?.config?.responseJsonSchema as Record<
    string,
    unknown
  >;
  assert.deepEqual(schema.required, [
    "schemaVersion",
    "classification",
    "certificates",
  ]);
  assert.equal(JSON.stringify(schema).includes("ocrText"), false);
  assert.equal(JSON.stringify(schema).includes("documentAnnotation"), false);
  assert.match(
    JSON.stringify(schema),
    /Total number of physical PDF pages, including completely blank pages/iu,
  );
  assert.deepEqual(result.result, extractionResult);
  assert.equal(
    result.metadata.promptVersion,
    "bir2307-agentic-v6-physical-page-count",
  );
  assert.equal(
    result.metadata.responseModel,
    "gemini-3-flash-preview-20260701",
  );
  assert.equal(result.metadata.attemptCount, 1);
  assert.deepEqual(result.metadata.usage, {
    promptTokenCount: 110,
    outputTokenCount: 70,
    thoughtTokenCount: 30,
    totalTokenCount: 210,
  });
  assert.equal("raw" in result, false);
});

test("Gemini payor verifier sends only the PNG crop with the dedicated contract", async () => {
  const requests: GenerateContentParameters[] = [];
  const client = createGeminiClient(config(), {
    generateContent: async (parameters) => {
      requests.push(parameters);
      return response({
        printedName: null,
        title: null,
        tin: null,
        companyName: null,
        confidence: 0.94,
        warnings: [],
      });
    },
    now: () => 1_000,
  });

  const crop = Buffer.from("payor-crop-only");
  const result = await client.extractPayorSigner!({
    sourceFileId: "source-1",
    revision: "revision-1-payor-crop",
    mimeType: "image/png",
    content: crop,
  });
  const contents = requests[0]?.contents as Array<{
    parts: Array<{
      text?: string;
      inlineData?: { mimeType?: string; data?: string };
    }>;
  }>;
  assert.equal(requests.length, 1);
  assert.match(contents[0]?.parts[0]?.text ?? "", /payor\/withholding-agent/iu);
  assert.match(
    contents[0]?.parts[0]?.text ?? "",
    /Never use a payee\/conforme/iu,
  );
  assert.equal(contents[0]?.parts[1]?.inlineData?.mimeType, "image/png");
  assert.equal(
    contents[0]?.parts[1]?.inlineData?.data,
    crop.toString("base64"),
  );
  assert.deepEqual(
    (requests[0]?.config?.responseJsonSchema as { required?: string[] })
      .required,
    ["printedName", "title", "tin", "companyName", "confidence", "warnings"],
  );
  assert.equal(result.result.printedName, null);
  assert.equal(result.metadata.promptVersion, "bir2307-payor-signer-v1");
  assert.equal(result.metadata.schemaVersion, 1);
});

test("Gemini rejects blocked, malformed, legacy OCR, and unexpected output", async (t) => {
  const cases: Array<{
    name: string;
    value: GenerateContentResponse;
    error: RegExp;
  }> = [
    {
      name: "blocked",
      value: response(
        {},
        { candidates: [], promptFeedback: { blockReason: "SAFETY" } },
      ),
      error: /blocked/iu,
    },
    {
      name: "empty",
      value: response({}, { text: "" }),
      error: /empty JSON/iu,
    },
    {
      name: "malformed",
      value: response({}, { text: "{not-json" }),
      error: /not valid JSON/iu,
    },
    {
      name: "legacy OCR contract",
      value: response({ ocrText: "secret transcript", documentAnnotation: {} }),
      error: /schema validation/iu,
    },
    {
      name: "unexpected property",
      value: response({ ...extractionResult, rawModelOutput: "forbidden" }),
      error: /Unrecognized key/iu,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const client = createGeminiClient(config(), {
        generateContent: async () => entry.value,
      });
      await assert.rejects(
        client.extract({
          sourceFileId: "source",
          revision: "revision",
          mimeType: "application/pdf",
          content: Buffer.from("private-pdf"),
        }),
        entry.error,
      );
    });
  }
});

test("Gemini retries HTTP 429 twice, honors Retry-After, and records attempts", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = createGeminiClient(config(), {
    generateContent: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw {
          status: 429,
          response: { headers: { "retry-after": "3" } },
        };
      }
      return response(extractionResult);
    },
    sleep: async (duration) => {
      delays.push(duration);
    },
    random: () => 0,
  });

  const result = await client.extract({
    sourceFileId: "source",
    revision: "revision",
    mimeType: "application/pdf",
    content: Buffer.from("pdf"),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [3_000, 3_000]);
  assert.equal(result.metadata.attemptCount, 3);
});

test("Gemini does not retry configuration or schema-related 4xx responses", async () => {
  let attempts = 0;
  const times = [1_000, 2_500];
  const client = createGeminiClient(config(), {
    generateContent: async () => {
      attempts += 1;
      throw { status: 400 };
    },
    now: () => times.shift() ?? 2_500,
  });

  await assert.rejects(
    client.extract({
      sourceFileId: "source",
      revision: "revision",
      mimeType: "application/pdf",
      content: Buffer.from("pdf"),
    }),
    (error: unknown) =>
      error instanceof GeminiExtractionError &&
      /after 1 attempt.*HTTP 400/iu.test(error.message) &&
      error.telemetry.latencyMs === 1_500,
  );
  assert.equal(attempts, 1);
});

test("Gemini ordinary logs contain telemetry but not PDF or extracted values", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const logger = {
    info: (_message: string, context?: Record<string, unknown>) => {
      logs.push(context ?? {});
    },
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const client = createGeminiClient(
    { ...config(), logger },
    { generateContent: async () => response(extractionResult) },
  );
  await client.extract({
    sourceFileId: "source",
    revision: "revision",
    mimeType: "application/pdf",
    content: Buffer.from("PRIVATE PDF BYTES"),
  });

  const serialized = JSON.stringify(logs);
  assert.match(serialized, /promptTokenCount/iu);
  assert.doesNotMatch(serialized, /PRIVATE PDF BYTES|THERMA|005031663/iu);
});
