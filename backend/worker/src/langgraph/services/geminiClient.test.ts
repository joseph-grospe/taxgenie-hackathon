import assert from "node:assert/strict";
import test from "node:test";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";

import { createGeminiClient, GeminiExtractionError } from "./geminiClient.ts";
import { withFieldConfidence } from "../testFixtures/fieldConfidence.ts";

const extractionResult = {
  schemaVersion: 3 as const,
  classification: {
    documentType: "BIR_2307" as const,
    confidence: 0.99,
    pageCount: 2,
  },
  certificates: [
    withFieldConfidence({
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
    }),
  ],
};

function response(
  value: unknown,
  overrides: Partial<GenerateContentResponse> = {},
): GenerateContentResponse {
  return {
    candidates: [{ content: { role: "model", parts: [{ text: "json" }] } }],
    text: JSON.stringify(value),
    modelVersion: "gemini-3.5-flash",
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
    model: "gemini-3.5-flash",
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
  assert.equal(requests[0]?.model, "gemini-3.5-flash");
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
    "bir2307-agentic-v10-identity-visibility",
  );
  assert.equal(
    result.metadata.responseModel,
    "gemini-3.5-flash",
  );
  assert.equal(result.metadata.attemptCount, 1);
  assert.equal(result.metadata.schemaVersion, 3);
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

test("Gemini identity reread sends all alternate crop views in one logical call", async () => {
  const requests: GenerateContentParameters[] = [];
  const client = createGeminiClient(config(), {
    generateContent: async (parameters) => {
      requests.push(parameters);
      return response({
        schemaVersion: 2,
        value: "00877857200000",
        confidence: 0.97,
        visibility: "readable",
      });
    },
    now: () => 1_000,
  });
  const tight = Buffer.from("tight-tin-crop");
  const expanded = Buffer.from("expanded-tin-crop");

  const result = await client.extractIdentityField!({
    sourceFileId: "source-1",
    revision: "revision-1-payee-tin",
    party: "payee",
    field: "tin",
    images: [
      { mimeType: "image/png", content: tight },
      { mimeType: "image/png", content: expanded },
    ],
  });
  const contents = requests[0]?.contents as Array<{
    parts: Array<{
      text?: string;
      inlineData?: { mimeType?: string; data?: string };
    }>;
  }>;

  assert.equal(requests.length, 1);
  assert.equal(contents[0]?.parts.length, 3);
  assert.equal(
    contents[0]?.parts[1]?.inlineData?.data,
    tight.toString("base64"),
  );
  assert.equal(
    contents[0]?.parts[2]?.inlineData?.data,
    expanded.toString("base64"),
  );
  assert.deepEqual(
    (requests[0]?.config?.responseJsonSchema as { required?: string[] })
      .required,
    ["schemaVersion", "value", "confidence", "visibility"],
  );
  assert.equal(requests[0]?.config?.thinkingConfig?.thinkingLevel, "MINIMAL");
  assert.equal(requests[0]?.config?.mediaResolution, "MEDIA_RESOLUTION_HIGH");
  assert.equal(result.result.confidence, 0.97);
  assert.equal(
    result.metadata.promptVersion,
    "bir2307-identity-field-reread-v2-visibility",
  );
});

test("Gemini rejects blocked, malformed, legacy OCR, and unexpected output", async (t) => {
  const cases: Array<{
    name: string;
    value: GenerateContentResponse;
    error: RegExp;
    failureCode:
      | "gemini_blocked_response"
      | "gemini_no_candidates"
      | "gemini_empty_response"
      | "gemini_invalid_json"
      | "gemini_schema_validation_failed";
    expectedAttempts: number;
  }> = [
    {
      name: "blocked",
      value: response(
        {},
        { candidates: [], promptFeedback: { blockReason: "SAFETY" } },
      ),
      error: /blocked/iu,
      failureCode: "gemini_blocked_response",
      expectedAttempts: 1,
    },
    {
      name: "no candidates",
      value: response({}, { candidates: [] }),
      error: /no candidates/iu,
      failureCode: "gemini_no_candidates",
      expectedAttempts: 3,
    },
    {
      name: "empty",
      value: response({}, { text: "" }),
      error: /empty JSON/iu,
      failureCode: "gemini_empty_response",
      expectedAttempts: 3,
    },
    {
      name: "malformed",
      value: response({}, { text: "{not-json" }),
      error: /not valid JSON/iu,
      failureCode: "gemini_invalid_json",
      expectedAttempts: 3,
    },
    {
      name: "legacy OCR contract",
      value: response({ ocrText: "secret transcript", documentAnnotation: {} }),
      error: /schema validation/iu,
      failureCode: "gemini_schema_validation_failed",
      expectedAttempts: 3,
    },
    {
      name: "unexpected property",
      value: response({ ...extractionResult, rawModelOutput: "forbidden" }),
      error: /schema validation/iu,
      failureCode: "gemini_schema_validation_failed",
      expectedAttempts: 3,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let attempts = 0;
      const client = createGeminiClient(config(), {
        generateContent: async () => {
          attempts += 1;
          return entry.value;
        },
        sleep: async () => undefined,
      });
      await assert.rejects(
        client.extract({
          sourceFileId: "source",
          revision: "revision",
          mimeType: "application/pdf",
          content: Buffer.from("private-pdf"),
        }),
        (error: unknown) =>
          error instanceof GeminiExtractionError &&
          entry.error.test(error.message) &&
          error.telemetry.failureCode === entry.failureCode &&
          error.telemetry.attemptCount === entry.expectedAttempts &&
          error.telemetry.responseModel === "gemini-3.5-flash" &&
          error.telemetry.usage?.totalTokenCount === 210,
      );
      assert.equal(attempts, entry.expectedAttempts);
    });
  }
});

test("Gemini retries empty, malformed, and schema-invalid responses within the configured limit", async (t) => {
  const cases = [
    {
      name: "empty response",
      value: response({}, { text: "" }),
    },
    {
      name: "malformed JSON",
      value: response({}, { text: "{not-json" }),
    },
    {
      name: "schema-invalid response",
      value: response({ ocrText: "legacy private transcript" }),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let attempts = 0;
      const delays: number[] = [];
      const client = createGeminiClient(config(), {
        generateContent: async () => {
          attempts += 1;
          return attempts === 1 ? entry.value : response(extractionResult);
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
        content: Buffer.from("private-pdf"),
      });

      assert.equal(attempts, 2);
      assert.deepEqual(delays, [1_000]);
      assert.equal(result.metadata.attemptCount, 2);
      assert.equal(result.result.certificates.length, 1);
    });
  }
});

test("Gemini accepts source-invalid dates and inconsistent totals without retrying", async () => {
  let attempts = 0;
  const client = createGeminiClient(config(), {
    generateContent: async () => {
      attempts += 1;
      return response({
        ...extractionResult,
        certificates: [
          {
            ...extractionResult.certificates[0],
            period: {
              ...extractionResult.certificates[0]!.period,
              end: "2026-06-31",
            },
            totals: { taxBase: "1.00", taxWithheld: "1.00" },
          },
        ],
      });
    },
  });

  const result = await client.extract({
    sourceFileId: "source",
    revision: "revision",
    mimeType: "application/pdf",
    content: Buffer.from("private-pdf"),
  });

  assert.equal(attempts, 1);
  assert.equal(result.result.certificates[0]?.period.end, "2026-06-31");
  assert.equal(result.result.certificates[0]?.totals.taxBase, "1.00");
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
      error.telemetry.failureCode === "gemini_http_400" &&
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

test("Gemini failure logs and telemetry exclude response and document content", async () => {
  const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
  const logger = {
    info: () => undefined,
    warn: (message: string, context?: Record<string, unknown>) => {
      logs.push({ message, context: context ?? {} });
    },
    error: () => undefined,
    debug: () => undefined,
  };
  const client = createGeminiClient(
    { ...config(), maxRetries: 0, logger },
    {
      generateContent: async () =>
        response({
          ocrText: "PRIVATE RESPONSE TEXT",
          extractedTin: "00503166300000",
        }),
    },
  );

  let telemetry: GeminiExtractionError["telemetry"] | undefined;
  await assert.rejects(
    client.extract({
      sourceFileId: "source",
      revision: "revision",
      mimeType: "application/pdf",
      content: Buffer.from("PRIVATE PDF BYTES"),
    }),
    (error: unknown) => {
      if (error instanceof GeminiExtractionError) {
        telemetry = error.telemetry;
        return true;
      }
      return false;
    },
  );

  assert.deepEqual(telemetry, {
    failureCode: "gemini_schema_validation_failed",
    attemptCount: 1,
    latencyMs: telemetry?.latencyMs,
    status: undefined,
    timeout: false,
    retryable: true,
    responseModel: "gemini-3.5-flash",
    usage: {
      promptTokenCount: 110,
      outputTokenCount: 70,
      thoughtTokenCount: 30,
      totalTokenCount: 210,
    },
    schemaIssues: [
      { path: "schemaVersion", code: "invalid_value" },
      { path: "classification", code: "invalid_type" },
      { path: "certificates", code: "invalid_type" },
      { path: "root", code: "unrecognized_keys" },
    ],
  });
  const serialized = JSON.stringify({ logs, telemetry });
  assert.match(serialized, /gemini_schema_validation_failed/iu);
  assert.match(serialized, /promptTokenCount/iu);
  assert.match(serialized, /schemaIssues/iu);
  assert.doesNotMatch(
    serialized,
    /PRIVATE PDF BYTES|PRIVATE RESPONSE TEXT|005031663/iu,
  );
});

test("Gemini caps schema telemetry at safe paths and codes", async () => {
  const client = createGeminiClient(
    { ...config(), maxRetries: 0 },
    {
      generateContent: async () =>
        response({
          ...extractionResult,
          classification: {
            documentType: "PRIVATE VALUE",
            confidence: "PRIVATE VALUE",
            pageCount: "PRIVATE VALUE",
          },
          certificates: [
            {
              ...extractionResult.certificates[0],
              certificateKey: 42,
              pageNumbers: ["PRIVATE VALUE"],
              period: {
                start: "PRIVATE VALUE",
                end: "PRIVATE VALUE",
                monthOfQuarter: "PRIVATE VALUE",
              },
              payee: {
                ...extractionResult.certificates[0]!.payee,
                name: 42,
              },
            },
          ],
        }),
    },
  );

  let telemetry: GeminiExtractionError["telemetry"] | undefined;
  await assert.rejects(
    client.extract({
      sourceFileId: "source",
      revision: "revision",
      mimeType: "application/pdf",
      content: Buffer.from("PRIVATE PDF BYTES"),
    }),
    (error: unknown) => {
      if (error instanceof GeminiExtractionError) {
        telemetry = error.telemetry;
        return true;
      }
      return false;
    },
  );

  assert.equal(telemetry?.schemaIssues?.length, 5);
  assert.equal(
    telemetry?.schemaIssues?.every(
      (issue) =>
        Object.keys(issue).sort().join(",") === "code,path" &&
        /^(?:root|[a-zA-Z0-9_*.[\]-]+)$/u.test(issue.path) &&
        /^[a-z0-9_]+$/u.test(issue.code),
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(telemetry),
    /PRIVATE VALUE|PRIVATE PDF BYTES/iu,
  );
});
