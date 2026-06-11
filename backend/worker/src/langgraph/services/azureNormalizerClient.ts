import type { Logger } from "@taxtrack/shared";
import { normalizeTinDigits } from "@taxtrack/shared";
import type { NormalizedFields, ExtractionPayload } from "../types";
import { AzureOpenAI } from "openai";
import {
  normalizePeriodCoveredValue,
  normalizePeriodEndValue,
  parseMoney,
} from "../utils/parsing";
import { getMainExtractionPlainText } from "../utils/pageProcessing";

export interface NormalizerConfig {
  apiKey: string;
  endpoint: string;
  deploymentName?: string;
  apiVersion?: string;
  timeoutMs?: number;
  logger?: Logger;
  client?: NormalizerChatClient;
}

interface NormalizerInput {
  extraction: ExtractionPayload;
  sourceFileId: string;
  revision: string;
}

export interface NormalizedResult {
  fields: NormalizedFields;
}

const DEFAULT_AZURE_TIMEOUT_MS = 180000;
const NORMALIZER_PROMPT_SCHEMA_VERSION = 3;

interface NormalizerChatCompletionResponse {
  model?: string | null;
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
  usage?: Record<string, unknown> | null;
}

interface NormalizerChatClient {
  chat: {
    completions: {
      create: (
        body: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<NormalizerChatCompletionResponse>;
    };
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.name} ${error.message} ${"cause" in error ? String(error.cause) : ""}`;
  return /abort|timed?\s*out|timeout/iu.test(message);
}

function stripCodeFence(raw: string): string {
  return raw
    .replace(/^```json\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function parseJsonPayload(raw: string): Record<string, unknown> {
  const normalized = stripCodeFence(raw.trim());
  if (!normalized) {
    return {};
  }

  const parsed = JSON.parse(normalized);
  if (parsed === null || typeof parsed !== "object") {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function toBooleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const lower = trimmed.toLowerCase();
    if (lower === "true") {
      return true;
    }

    if (lower === "false") {
      return false;
    }
  }

  return undefined;
}

function sanitizeConfidenceMap(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      const numeric = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(numeric)) {
        return undefined;
      }

      return [key, Math.min(1, Math.max(0, numeric))] as const;
    })
    .filter((entry): entry is readonly [string, number] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getMetadataStatus(metadata: Record<string, unknown>): string {
  const zoneOcrFallback = metadata.zoneOcrFallback;
  if (!isRecord(zoneOcrFallback)) {
    return "not_run";
  }

  return typeof zoneOcrFallback.status === "string"
    ? zoneOcrFallback.status
    : "unknown";
}

function getZoneFallbackBlocks(
  raw: Record<string, unknown>,
): Array<{ zoneId: string; content: string }> {
  const blocks = raw.zoneOcrFallbackText;
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .filter(isRecord)
    .map((block) => {
      const text = typeof block.text === "string" ? block.text.trim() : "";
      const markdown =
        typeof block.markdown === "string" ? block.markdown.trim() : "";

      return {
        zoneId: typeof block.zoneId === "string" ? block.zoneId : "unknown",
        content: markdown || text,
      };
    })
    .filter((block) => block.content.length > 0);
}

function toTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function getTokenUsageSummary(
  usage: NormalizerChatCompletionResponse["usage"],
): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  if (!isRecord(usage)) {
    return {};
  }

  const promptTokens = toTokenCount(usage.prompt_tokens);
  const completionTokens = toTokenCount(usage.completion_tokens);
  const totalTokens =
    toTokenCount(usage.total_tokens) ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function buildNormalizerPromptPayload(input: NormalizerInput) {
  const metadata = input.extraction.metadata ?? {};
  const zoneFallbackBlocks = getZoneFallbackBlocks(input.extraction.raw);

  return {
    payloadSchemaVersion: NORMALIZER_PROMPT_SCHEMA_VERSION,
    ocr: {
      main: {
        text: getMainExtractionPlainText(input.extraction) ?? "",
      },
      zoneFallback: {
        status: getMetadataStatus(metadata),
        blocks: zoneFallbackBlocks,
      },
    },
  };
}

export const AZURE_NORMALIZER_SYSTEM_PROMPT = `
You are a tax document extraction normalizer for OCR text from BIR Form 2307.

Return strict JSON only with keys:
periodCovered, periodEnd, payeeName, payeeTin, payeeAddress, payeeZip,
payorName, payorTin, payorAddress, payorZip,
atcCode, taxBase, taxWithheld,
printedName, signatoryTitle, signatoryTin,
signaturePresent, signatureText, companyName, confidences.

Rules:
- Use null when unknown.
- Preserve extracted text exactly except for trimming spaces, unless a rule below says to normalize a field format.
- Do not hallucinate missing values.
- The user payload has ocr.main.text and ocr.zoneFallback.blocks.
- ocr.main.text is the full-page OCR context. ocr.zoneFallback.blocks contains targeted high-resolution OCR from specific BIR 2307 zones.
- Preserve and read each ocr.zoneFallback.blocks[].content value as OCR evidence.
- Use ocr.zoneFallback to fill missing fields and to correct ocr.main fields that are malformed, repeated, or unclear.
- When ocr.main and ocr.zoneFallback conflict, prefer the value that is complete, field-specific, and structurally valid.
- Philippine TINs are usually 9 base digits or 12-14 digits with branch code. Treat very long repeated digit runs as malformed unless the document clearly labels them as one complete TIN.
- "periodEnd" must be a single ending date in the exact format MM-DD-YYYY.
- "periodCovered" must be a date range in the exact format MM-DD-YYYY to MM-DD-YYYY.
- If the document shows compact OCR like "0831 2025" or "08/31/2025", normalize it to MM-DD-YYYY.
- Do not return periodCovered as a single date. Do not return periodEnd as a range.
- TIN fields ("payeeTin", "payorTin", and "signatoryTin") must contain digits only.
- For TIN fields, remove spaces, hyphens, commas, letters, OCR separators, and all other non-digit characters.
- Preserve leading zeroes in TIN fields when they are visible in the source text.
- Do not infer, pad, truncate, or invent missing TIN digits.
- "printedName" is the typed or OCR-detected name near the signature block.
- "signatureText" is only the actual OCR text of a signature if explicitly present; otherwise null.
- "signaturePresent" is true only if there is evidence that the document appears signed or has text/name populated in the payor signature block; otherwise false.
- Do not treat the label "Signature over Printed Name..." as the signature itself.
- If a name appears above or near the payor signature block, extract it as printedName, not as signatureText.
- "signatoryTitle" and "signatoryTin" should be parsed from nearby text when possible.
- "companyName" should be the relevant organization associated with the signatory if clearly indicated; otherwise null.
- confidences must be an object with a confidence score from 0 to 1 for each extracted field.
`;

function toTinStringOrUndefined(value: unknown): string | undefined {
  return normalizeTinDigits(value) ?? undefined;
}

export function createAzureNormalizerClient(config: NormalizerConfig): {
  normalize: (input: NormalizerInput) => Promise<NormalizedResult>;
} {
  const deployment = config.deploymentName ?? "gpt-4.1";
  const apiVersion = config.apiVersion ?? "2024-04-01-preview";
  const logger = config.logger;
  const endpoint = config.endpoint.replace(/\/+$/u, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_AZURE_TIMEOUT_MS;

  const client: NormalizerChatClient =
    config.client ??
    (new AzureOpenAI({
      apiKey: config.apiKey,
      apiVersion,
      endpoint,
      deployment,
      timeout: timeoutMs,
    }) as unknown as NormalizerChatClient);
  return {
    async normalize(input: NormalizerInput): Promise<NormalizedResult> {
      const startedAt = new Date().toISOString();
      const promptPayloadJson = JSON.stringify(
        buildNormalizerPromptPayload(input),
      );

      console.log({ promptPayloadJson });
      const response = await client.chat.completions
        .create(
          {
            messages: [
              {
                role: "system",
                content: AZURE_NORMALIZER_SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: promptPayloadJson,
              },
            ],
            model: deployment,
            temperature: 0.1,
            max_tokens: 2048,
            top_p: 1,
            response_format: {
              type: "json_object",
            },
          },
          {
            timeout: timeoutMs,
          },
        )
        .catch((error: unknown) => {
          if (isTimeoutError(error)) {
            logger?.warn("Azure normalizer request timed out", {
              sourceFileId: input.sourceFileId,
              revision: input.revision,
              timeoutMs,
              deployment,
            });
            throw new Error(
              `Azure normalizer request timed out after ${timeoutMs}ms`,
            );
          }

          throw error;
        });

      if (!response.choices?.length) {
        logger?.warn("Azure normalizer request returned no choices", {
          sourceFileId: input.sourceFileId,
          revision: input.revision,
        });
        throw new Error("Azure normalizer request returned no choices");
      }

      const content = response.choices?.[0]?.message?.content ?? "{}";
      const normalized = parseJsonPayload(content);
      console.log({ normalized });
      const elapsedMs = Date.now() - Date.parse(startedAt);

      const taxBase = parseMoney(normalized.taxBase);
      const taxWithheld = parseMoney(normalized.taxWithheld);
      const atcCode = toStringOrUndefined(normalized.atcCode);
      const periodCovered = normalizePeriodCoveredValue(
        normalized.periodCovered,
      );
      const periodEnd = normalizePeriodEndValue(
        normalized.periodEnd ?? normalized.periodCovered,
      );
      const payeeName = toStringOrUndefined(normalized.payeeName);
      const payeeTin = toTinStringOrUndefined(normalized.payeeTin);
      const payeeAddress = toStringOrUndefined(normalized.payeeAddress);
      const payeeZip = toStringOrUndefined(normalized.payeeZip);
      const payorName = toStringOrUndefined(normalized.payorName);
      const payorTin = toTinStringOrUndefined(normalized.payorTin);
      const payorAddress = toStringOrUndefined(normalized.payorAddress);
      const payorZip = toStringOrUndefined(normalized.payorZip);
      const printedName = toStringOrUndefined(normalized.printedName);
      const signatoryTitle = toStringOrUndefined(normalized.signatoryTitle);
      const signatoryTin = toTinStringOrUndefined(normalized.signatoryTin);
      const signaturePresent = toBooleanOrUndefined(
        normalized.signaturePresent,
      );
      const signatureText = toStringOrUndefined(normalized.signatureText);
      const companyName = toStringOrUndefined(normalized.companyName);
      const legacySignature = normalized.signature;
      const confidenceMap = sanitizeConfidenceMap(normalized.confidences);
      const tokenUsage = getTokenUsageSummary(response.usage);

      return {
        fields: {
          periodCovered,
          periodEnd,
          payeeName,
          payeeTin,
          payeeAddress,
          payeeZip,
          payorName,
          payorTin,
          payorAddress,
          payorZip,
          atcCode,
          taxBase: Number.isFinite(taxBase) ? taxBase : undefined,
          taxWithheld: Number.isFinite(taxWithheld) ? taxWithheld : undefined,
          printedName,
          signatoryTitle,
          signatoryTin,
          signaturePresent,
          signatureText,
          signature:
            signaturePresent ??
            toBooleanOrUndefined(legacySignature) ??
            toStringOrUndefined(legacySignature),
          companyName,
          confidenceMap,
          normalizedFrom: "azure-openai",
          normalizedAt: new Date().toISOString(),
          normalizerElapsedMs: elapsedMs,
          normalizerPayload: {
            payloadSchemaVersion: NORMALIZER_PROMPT_SCHEMA_VERSION,
            sourceFileId: input.sourceFileId,
            revision: input.revision,
            normalizerProvider: "azure-openai",
            normalizerDeployment: deployment,
            normalizerResponseModel:
              typeof response.model === "string" ? response.model : undefined,
            normalizerApiVersion: apiVersion,
            normalizerPromptPayloadChars: promptPayloadJson.length,
            promptTokens: tokenUsage.promptTokens,
            completionTokens: tokenUsage.completionTokens,
            totalTokens: tokenUsage.totalTokens,
            zoneFallbackStatus: getMetadataStatus(input.extraction.metadata),
            zoneFallbackBlockCount: getZoneFallbackBlocks(input.extraction.raw)
              .length,
          },
        },
      };
    },
  };
}
