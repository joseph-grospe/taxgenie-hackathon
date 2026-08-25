import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import type { Logger } from "@taxtrack/shared";
import type {
  DocumentExtractionClient,
  DocumentExtractionMetadata,
  DocumentExtractionRequest,
  DocumentExtractionUsage,
  IdentityFieldRereadRequest,
} from "./documentExtractionClient";
import {
  buildIdentityFieldRereadPrompt,
  IDENTITY_FIELD_REREAD_PROMPT_VERSION,
  IDENTITY_FIELD_REREAD_RESPONSE_SCHEMA,
  IDENTITY_FIELD_REREAD_SCHEMA_VERSION,
  identityFieldRereadResultSchema,
} from "./identityFieldRereadContract";
import {
  DOCUMENT_EXTRACTION_PROMPT,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
  DOCUMENT_EXTRACTION_SCHEMA_VERSION,
  documentExtractionResultSchema,
} from "./extractionContract";
import {
  PAYOR_SIGNER_EXTRACTION_PROMPT,
  PAYOR_SIGNER_EXTRACTION_PROMPT_VERSION,
  PAYOR_SIGNER_EXTRACTION_RESPONSE_SCHEMA,
  PAYOR_SIGNER_EXTRACTION_SCHEMA_VERSION,
  payorSignerExtractionResultSchema,
} from "./payorSignerContract";
import type {
  GeminiExtractionConfig,
  GeminiMediaResolution,
  GeminiThinkingLevel,
} from "./geminiConfig";

export interface GeminiClientConfig extends GeminiExtractionConfig {
  logger?: Logger;
}

type GenerateContent = (
  parameters: GenerateContentParameters,
) => Promise<GenerateContentResponse>;

export interface GeminiClientOptions {
  generateContent?: GenerateContent;
  sleep?: (durationMs: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export type GeminiFailureCode =
  | `gemini_http_${number}`
  | "gemini_timeout"
  | "gemini_request_failed"
  | "gemini_no_response"
  | "gemini_blocked_response"
  | "gemini_no_candidates"
  | "gemini_empty_response"
  | "gemini_invalid_json"
  | "gemini_schema_validation_failed";

export interface GeminiSchemaIssue {
  path: string;
  code: string;
}

export class GeminiExtractionError extends Error {
  constructor(
    message: string,
    readonly telemetry: {
      failureCode: GeminiFailureCode;
      attemptCount: number;
      latencyMs: number;
      status?: number;
      timeout: boolean;
      retryable: boolean;
      responseModel?: string;
      usage?: DocumentExtractionUsage;
      schemaIssues?: GeminiSchemaIssue[];
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GeminiExtractionError";
  }
}

class GeminiResponseError extends Error {
  constructor(
    message: string,
    readonly failureCode: GeminiFailureCode,
    readonly retryable: boolean,
    readonly schemaIssues?: GeminiSchemaIssue[],
  ) {
    super(message);
    this.name = "GeminiResponseError";
  }
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_SCHEMA_ISSUES = 5;
const SAFE_SCHEMA_PATH_SEGMENTS = new Set([
  "schemaVersion",
  "classification",
  "documentType",
  "confidence",
  "fieldConfidence",
  "pageCount",
  "certificates",
  "certificateKey",
  "pageNumbers",
  "period",
  "start",
  "end",
  "monthOfQuarter",
  "payee",
  "payor",
  "name",
  "tin",
  "address",
  "zip",
  "taxRows",
  "lineNumber",
  "pageNumber",
  "atcCode",
  "description",
  "monthlyAmounts",
  "first",
  "second",
  "third",
  "taxBase",
  "taxRate",
  "taxWithheld",
  "primaryAtcCode",
  "totals",
  "signer",
  "printedName",
  "title",
  "companyName",
  "signature",
  "present",
  "source",
  "evidence",
  "warnings",
  "payorSigner",
  "isMatch",
  "reason",
]);

const MEDIA_RESOLUTIONS: Record<GeminiMediaResolution, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

const THINKING_LEVELS: Record<GeminiThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSafeSchemaIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>,
): GeminiSchemaIssue[] {
  return issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => ({
    path:
      issue.path
        .map((segment) => {
          if (typeof segment === "number") {
            return "[]";
          }
          if (
            typeof segment === "string" &&
            SAFE_SCHEMA_PATH_SEGMENTS.has(segment)
          ) {
            return segment;
          }
          return "*";
        })
        .join(".") || "root",
    code: /^[a-z0-9_]+$/u.test(issue.code) ? issue.code : "unknown",
  }));
}

function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === "application/pdf" || normalized === "image/png"
    ? normalized
    : "application/pdf";
}

function getStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  for (const key of ["status", "statusCode", "code"] as const) {
    const value = error[key];
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    ) {
      return value;
    }
    if (typeof value === "string" && /^\d{3}$/u.test(value)) {
      return Number(value);
    }
  }

  const response = error.response;
  return isRecord(response) && typeof response.status === "number"
    ? response.status
    : undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = isRecord(error.response) ? error.response : undefined;
  const headers = response?.headers ?? error.headers;
  let retryAfter: unknown;
  if (isRecord(headers)) {
    retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  } else if (
    headers &&
    typeof (headers as { get?: unknown }).get === "function"
  ) {
    retryAfter = (headers as { get(name: string): unknown }).get("retry-after");
  }

  if (typeof retryAfter === "number" && retryAfter >= 0) {
    return retryAfter * 1_000;
  }
  if (typeof retryAfter !== "string" || retryAfter.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt)
    ? Math.max(0, retryAt - Date.now())
    : undefined;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /abort|timed?\s*out|timeout/iu.test(`${error.name} ${error.message}`)
  );
}

function isRetryable(error: unknown): boolean {
  const status = getStatusCode(error);
  return (
    (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) ||
    isTimeoutError(error)
  );
}

function parseJsonResponse(
  response: GenerateContentResponse,
  responseLabel: string,
): unknown {
  if (!response.candidates || response.candidates.length === 0) {
    const blockReason = response.promptFeedback?.blockReason;
    throw new GeminiResponseError(
      blockReason
        ? `Gemini ${responseLabel} response was blocked (${blockReason}).`
        : `Gemini ${responseLabel} response contained no candidates.`,
      blockReason ? "gemini_blocked_response" : "gemini_no_candidates",
      !blockReason,
    );
  }

  const text = response.text?.trim();
  if (!text) {
    throw new GeminiResponseError(
      `Gemini ${responseLabel} response contained empty JSON.`,
      "gemini_empty_response",
      true,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiResponseError(
      `Gemini ${responseLabel} response was not valid JSON.`,
      "gemini_invalid_json",
      true,
    );
  }
}

function parseResponse(response: GenerateContentResponse) {
  const value = parseJsonResponse(response, "extraction");
  const parsed = documentExtractionResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new GeminiResponseError(
      "Gemini extraction response failed schema validation.",
      "gemini_schema_validation_failed",
      true,
      buildSafeSchemaIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

function parsePayorSignerResponse(response: GenerateContentResponse) {
  const value = parseJsonResponse(response, "payor signer");
  const parsed = payorSignerExtractionResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new GeminiResponseError(
      "Gemini payor signer response failed schema validation.",
      "gemini_schema_validation_failed",
      true,
      buildSafeSchemaIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

function parseIdentityFieldRereadResponse(response: GenerateContentResponse) {
  const value = parseJsonResponse(response, "identity field reread");
  const parsed = identityFieldRereadResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new GeminiResponseError(
      "Gemini identity field reread response failed schema validation.",
      "gemini_schema_validation_failed",
      true,
      buildSafeSchemaIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

function buildUsageMetadata(
  response: GenerateContentResponse,
): DocumentExtractionUsage {
  const usage = response.usageMetadata;
  return {
    promptTokenCount: usage?.promptTokenCount,
    outputTokenCount: usage?.candidatesTokenCount,
    thoughtTokenCount: usage?.thoughtsTokenCount,
    totalTokenCount: usage?.totalTokenCount,
  };
}

export function createGeminiClient(
  config: GeminiClientConfig,
  options: GeminiClientOptions = {},
): DocumentExtractionClient {
  const ai = options.generateContent
    ? undefined
    : new GoogleGenAI({ apiKey: config.apiKey });
  const generateContent =
    options.generateContent ??
    ((parameters: GenerateContentParameters) =>
      ai!.models.generateContent(parameters));
  const sleep =
    options.sleep ??
    ((durationMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
      }));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  async function executeStructuredRequest<T>(input: {
    request: DocumentExtractionRequest | IdentityFieldRereadRequest;
    prompt: string;
    responseSchema: object;
    promptVersion: string;
    schemaVersion: number;
    operation:
      | "document"
      | "payor_signer"
      | "identity_field_reread";
    parse: (response: GenerateContentResponse) => T;
    thinkingLevel?: GeminiThinkingLevel;
    mediaResolution?: GeminiMediaResolution;
  }): Promise<{ result: T; metadata: DocumentExtractionMetadata }> {
    const startedAt = new Date().toISOString();
    const started = now();
    const thinkingLevel = input.thinkingLevel ?? config.thinkingLevel;
    const mediaResolution = input.mediaResolution ?? config.mediaResolution;
    const parameters: GenerateContentParameters = {
      model: config.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            ...("images" in input.request
              ? input.request.images.map((image) => ({
                  inlineData: {
                    mimeType: normalizeMimeType(image.mimeType),
                    data: image.content.toString("base64"),
                  },
                }))
              : [
                  {
                    inlineData: {
                      mimeType: normalizeMimeType(input.request.mimeType),
                      data: input.request.content.toString("base64"),
                    },
                  },
                ]),
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: input.responseSchema,
        thinkingConfig: {
          thinkingLevel: THINKING_LEVELS[thinkingLevel],
          includeThoughts: false,
        },
        mediaResolution: MEDIA_RESOLUTIONS[mediaResolution],
        httpOptions: {
          timeout: config.timeoutMs,
          retryOptions: { attempts: 1 },
        },
      },
    };

    let response: GenerateContentResponse | undefined;
    let result: T | undefined;
    let attemptCount = 0;
    while (attemptCount <= config.maxRetries) {
      attemptCount += 1;
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        config.timeoutMs,
      );
      let attemptResponse: GenerateContentResponse | undefined;

      try {
        attemptResponse = await generateContent({
          ...parameters,
          config: {
            ...parameters.config,
            abortSignal: abortController.signal,
          },
        });
        result = input.parse(attemptResponse);
        response = attemptResponse;
        clearTimeout(timeout);
        break;
      } catch (error) {
        clearTimeout(timeout);
        const responseError =
          error instanceof GeminiResponseError ? error : undefined;
        const retryable = responseError?.retryable ?? isRetryable(error);
        const status = getStatusCode(error);
        const timedOut = isTimeoutError(error);
        const failureCode: GeminiFailureCode = responseError
          ? responseError.failureCode
          : status !== undefined
            ? `gemini_http_${status}`
            : timedOut
              ? "gemini_timeout"
              : "gemini_request_failed";
        config.logger?.warn(
          responseError
            ? "gemini_extraction_response_rejected"
            : "gemini_extraction_request_failed",
          {
            provider: "gemini",
            operation: input.operation,
            model: config.model,
            sourceFileId: input.request.sourceFileId,
            revision: input.request.revision,
            attemptCount,
            failureCode,
            status,
            retryable,
            timeout: timedOut,
            responseModel: attemptResponse?.modelVersion,
            schemaIssues: responseError?.schemaIssues,
            ...(attemptResponse
              ? buildUsageMetadata(attemptResponse)
              : undefined),
          },
        );

        if (!retryable || attemptCount > config.maxRetries) {
          const reason = responseError
            ? responseError.message
            : status !== undefined
              ? `Gemini ${input.operation} extraction failed after ${attemptCount} attempt(s): HTTP ${status}.`
              : timedOut
                ? `Gemini ${input.operation} extraction failed after ${attemptCount} attempt(s): timeout.`
                : `Gemini ${input.operation} extraction failed after ${attemptCount} attempt(s): request error.`;
          throw new GeminiExtractionError(
            reason,
            {
              failureCode,
              attemptCount,
              latencyMs: Math.max(0, now() - started),
              status,
              timeout: timedOut,
              retryable,
              responseModel: attemptResponse?.modelVersion,
              usage: attemptResponse
                ? buildUsageMetadata(attemptResponse)
                : undefined,
              schemaIssues: responseError?.schemaIssues,
            },
            { cause: error },
          );
        }

        const exponentialMs = BASE_RETRY_DELAY_MS * 2 ** (attemptCount - 1);
        const jitterMs = Math.floor(exponentialMs * 0.25 * random());
        await sleep(
          Math.max(getRetryAfterMs(error) ?? 0, exponentialMs + jitterMs),
        );
      }
    }

    if (!response || result === undefined) {
      throw new GeminiExtractionError(
        `Gemini ${input.operation} extraction failed after ${attemptCount} attempt(s): no response.`,
        {
          failureCode: "gemini_no_response",
          attemptCount,
          latencyMs: Math.max(0, now() - started),
          timeout: false,
          retryable: false,
        },
      );
    }

    const finishedAt = new Date().toISOString();
    const latencyMs = now() - started;
    const usage = buildUsageMetadata(response);
    config.logger?.info("gemini_extraction_request_completed", {
      provider: "gemini",
      operation: input.operation,
      requestedModel: config.model,
      responseModel: response.modelVersion,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      sourceFileId: input.request.sourceFileId,
      revision: input.request.revision,
      attemptCount,
      latencyMs,
      ...usage,
    });

    return {
      result,
      metadata: {
        provider: "gemini",
        requestedModel: config.model,
        responseModel: response.modelVersion,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        thinkingLevel,
        mediaResolution,
        startedAt,
        finishedAt,
        latencyMs,
        attemptCount,
        usage,
      },
    };
  }

  return {
    extract: (request) =>
      executeStructuredRequest({
        request,
        prompt: DOCUMENT_EXTRACTION_PROMPT,
        responseSchema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
        promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
        schemaVersion: DOCUMENT_EXTRACTION_SCHEMA_VERSION,
        operation: "document",
        parse: parseResponse,
      }),
    extractPayorSigner: (request) =>
      executeStructuredRequest({
        request,
        prompt: PAYOR_SIGNER_EXTRACTION_PROMPT,
        responseSchema: PAYOR_SIGNER_EXTRACTION_RESPONSE_SCHEMA,
        promptVersion: PAYOR_SIGNER_EXTRACTION_PROMPT_VERSION,
        schemaVersion: PAYOR_SIGNER_EXTRACTION_SCHEMA_VERSION,
        operation: "payor_signer",
        parse: parsePayorSignerResponse,
      }),
    extractIdentityField: (request) =>
      executeStructuredRequest({
        request,
        prompt: buildIdentityFieldRereadPrompt(request),
        responseSchema: IDENTITY_FIELD_REREAD_RESPONSE_SCHEMA,
        promptVersion: IDENTITY_FIELD_REREAD_PROMPT_VERSION,
        schemaVersion: IDENTITY_FIELD_REREAD_SCHEMA_VERSION,
        operation: "identity_field_reread",
        parse: parseIdentityFieldRereadResponse,
        thinkingLevel: "minimal",
        mediaResolution: "high",
      }),
  };
}
