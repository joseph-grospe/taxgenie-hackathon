import type { Logger } from "@taxtrack/shared";
import { normalizeTinDigits } from "@taxtrack/shared";
import type { NormalizedFields, ExtractionPayload } from "../types";
import { AzureOpenAI } from "openai";
import {
  buildPeriodCoveredValue,
  normalizePeriodCoveredValue,
  normalizePeriodEndValue,
  normalizePeriodStartValue,
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
export const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-08-01-preview";
const NORMALIZER_PROMPT_SCHEMA_VERSION = 3;
export const NORMALIZER_RESPONSE_SCHEMA_NAME = "bir2307_normalized_fields";
export const NORMALIZER_RESPONSE_SCHEMA_VERSION = 1;
const MONTH_OF_QUARTER_VALUES = ["first", "second", "third"] as const;
type MonthOfQuarter = (typeof MONTH_OF_QUARTER_VALUES)[number];
const ATC_CODE_PATTERN = /\b[A-Z]{2}\d{3}\b/iu;
const CANONICAL_TIN_LENGTHS = new Set([9, 12, 13, 14]);
const MIN_STRUCTURED_OUTPUTS_API_DATE = "2024-08-01";
const NORMALIZER_CONFIDENCE_FIELDS = [
  "periodStart",
  "periodCovered",
  "periodEnd",
  "monthOfQuarter",
  "payeeName",
  "payeeTin",
  "payeeAddress",
  "payeeZip",
  "payorName",
  "payorTin",
  "payorAddress",
  "payorZip",
  "atcCode",
  "taxBase",
  "taxWithheld",
  "printedName",
  "signatoryTitle",
  "signatoryTin",
  "signaturePresent",
  "companyName",
] as const;
const NORMALIZER_RESPONSE_FIELDS = [
  ...NORMALIZER_CONFIDENCE_FIELDS,
  "confidences",
] as const;

function nullableJsonSchemaType(type: "string" | "number" | "boolean") {
  return { type: [type, "null"] };
}

export const AZURE_NORMALIZER_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: NORMALIZER_RESPONSE_SCHEMA_NAME,
    strict: true,
    schema: {
      type: "object",
      properties: {
        periodStart: nullableJsonSchemaType("string"),
        periodCovered: nullableJsonSchemaType("string"),
        periodEnd: nullableJsonSchemaType("string"),
        monthOfQuarter: {
          type: ["string", "null"],
          enum: ["first", "second", "third", null],
        },
        payeeName: nullableJsonSchemaType("string"),
        payeeTin: nullableJsonSchemaType("string"),
        payeeAddress: nullableJsonSchemaType("string"),
        payeeZip: nullableJsonSchemaType("string"),
        payorName: nullableJsonSchemaType("string"),
        payorTin: nullableJsonSchemaType("string"),
        payorAddress: nullableJsonSchemaType("string"),
        payorZip: nullableJsonSchemaType("string"),
        atcCode: nullableJsonSchemaType("string"),
        taxBase: nullableJsonSchemaType("number"),
        taxWithheld: nullableJsonSchemaType("number"),
        printedName: nullableJsonSchemaType("string"),
        signatoryTitle: nullableJsonSchemaType("string"),
        signatoryTin: nullableJsonSchemaType("string"),
        signaturePresent: nullableJsonSchemaType("boolean"),
        companyName: nullableJsonSchemaType("string"),
        confidences: {
          type: "object",
          properties: Object.fromEntries(
            NORMALIZER_CONFIDENCE_FIELDS.map((field) => [
              field,
              nullableJsonSchemaType("number"),
            ]),
          ),
          required: [...NORMALIZER_CONFIDENCE_FIELDS],
          additionalProperties: false,
        },
      },
      required: [...NORMALIZER_RESPONSE_FIELDS],
      additionalProperties: false,
    },
  },
} as const;

interface NormalizerChatCompletionResponse {
  model?: string | null;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
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

function normalizeAzureApiVersion(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : DEFAULT_AZURE_OPENAI_API_VERSION;
}

function assertStructuredOutputsApiVersion(apiVersion: string) {
  if (apiVersion.trim().toLowerCase() === "v1") {
    return;
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/u.exec(apiVersion);
  if (!dateMatch) {
    return;
  }

  const comparableDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  if (comparableDate < MIN_STRUCTURED_OUTPUTS_API_DATE) {
    throw new Error(
      `Azure OpenAI Structured Outputs require API version ${MIN_STRUCTURED_OUTPUTS_API_DATE}-preview or later; configured ${apiVersion}.`,
    );
  }
}

function isStructuredOutputsRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.name} ${error.message} ${"cause" in error ? String(error.cause) : ""}`;
  return /json_schema|structured\s+outputs?|response_format/iu.test(message);
}

function toStructuredOutputsRequestError(
  error: Error,
  input: {
    apiVersion: string;
    deployment: string;
  },
): Error {
  return new Error(
    `Azure normalizer Structured Outputs request failed. Ensure deployment ${input.deployment} supports json_schema response_format and AZURE_OPENAI_API_VERSION is ${MIN_STRUCTURED_OUTPUTS_API_DATE}-preview or later; configured ${input.apiVersion}. Original error: ${error.message}`,
  );
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

function toMonthOfQuarterOrUndefined(
  value: unknown,
): MonthOfQuarter | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (MONTH_OF_QUARTER_VALUES.includes(normalized as MonthOfQuarter)) {
    return normalized as MonthOfQuarter;
  }

  return undefined;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return [];
  }

  return trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeAtcCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().toUpperCase().match(ATC_CODE_PATTERN)?.[0];
}

function isSameMoneyValue(left: number | undefined, right: number | undefined) {
  return (
    typeof left === "number" &&
    typeof right === "number" &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) < 0.01
  );
}

function inferMonthOfQuarterFromTaxBasePlacement(input: {
  atcCode?: string;
  ocrText: string;
  taxBase?: number;
}): MonthOfQuarter | undefined {
  if (
    typeof input.taxBase !== "number" ||
    !Number.isFinite(input.taxBase) ||
    input.taxBase <= 0
  ) {
    return undefined;
  }

  const expectedAtcCode = normalizeAtcCode(input.atcCode);
  const rows = input.ocrText.replace(/\\n/gu, "\n").split(/\r?\n/u);

  for (const row of rows) {
    const cells = splitMarkdownTableRow(row);
    if (cells.length === 0) {
      continue;
    }

    const atcIndex = cells.findIndex((cell) => {
      const cellAtcCode = normalizeAtcCode(cell);
      return expectedAtcCode
        ? cellAtcCode === expectedAtcCode
        : Boolean(cellAtcCode);
    });
    if (atcIndex < 0) {
      continue;
    }

    const monthlyAmounts = cells
      .slice(atcIndex + 1)
      .map((cell) => parseMoney(cell))
      .filter((value): value is number => typeof value === "number")
      .slice(0, 3);
    const matchingIndex = monthlyAmounts.findIndex((amount) =>
      isSameMoneyValue(amount, input.taxBase),
    );

    if (matchingIndex >= 0) {
      return MONTH_OF_QUARTER_VALUES[matchingIndex];
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
      if (raw === null || raw === undefined) {
        return undefined;
      }

      if (typeof raw === "string" && raw.trim().length === 0) {
        return undefined;
      }

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
periodStart, periodCovered, periodEnd, monthOfQuarter, payeeName, payeeTin, payeeAddress, payeeZip,
payorName, payorTin, payorAddress, payorZip,
atcCode, taxBase, taxWithheld,
printedName, signatoryTitle, signatoryTin,
signaturePresent, companyName, confidences.

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
- "periodStart" must be a single starting date in the exact format MM-DD-YYYY.
- "periodEnd" must be a single ending date in the exact format MM-DD-YYYY.
- "periodCovered" must be a date range in the exact format MM-DD-YYYY to MM-DD-YYYY.
- "monthOfQuarter" must be "first", "second", or "third". In Part III, use the row's taxBase placement under "1st Month of the Quarter", "2nd Month of the Quarter", or "3rd Month of the Quarter" for the ATC row. Do not infer this value from periodEnd. Use null when the certificate does not clearly show it.
- If the document shows compact OCR like "0831 2025" or "08/31/2025", normalize it to MM-DD-YYYY.
- Do not return periodCovered as a single date. Do not return periodStart or periodEnd as a range.
- TIN fields ("payeeTin", "payorTin", and "signatoryTin") must contain digits only.
- For TIN fields, remove spaces, hyphens, commas, letters, OCR separators, and all other non-digit characters.
- Preserve leading zeroes in TIN fields when they are visible in the source text.
- Do not infer, pad, truncate, or invent missing TIN digits.
- For BIR 2307 item 2 and item 6 TIN rows, OCR may represent boxed digits as tokens like "01", "31", "61", or "71", where the trailing "1" is a box or line artifact. It may also merge adjacent boxed tokens into cells like "010 0", "516 9", "017 2", or "010 10". Only inside the labeled Taxpayer Identification Number (TIN) row, decode tokens that are either a single digit or two digits ending in "1" by taking the visible digit before the trailing "1"; for merged boxed cells, remove the trailing artifact "1" after each visible digit. Example: "01 01 5 | 01 31 1 | 61 61 3 | 01 01 01" becomes "005031663000". Apply this only when the decoded result has a valid Philippine TIN length of 9, 12, 13, or 14 digits; otherwise return null.
- "printedName" is the typed or OCR-detected name near the signature block.
- "signaturePresent" is true only if there is evidence that the document appears signed or has text/name populated in the payor signature block; otherwise false.
- Do not treat the label "Signature over Printed Name..." as the signature itself.
- If a name appears above or near the payor signature block, extract it as printedName.
- "signatoryTitle" and "signatoryTin" should be parsed from nearby text when possible.
- "companyName" should be the relevant organization associated with the signatory if clearly indicated; otherwise null.
- confidences must be an object with a confidence score from 0 to 1 for each extracted field.
`;

function toTinStringOrUndefined(value: unknown): string | undefined {
  return normalizeTinDigits(value) ?? undefined;
}

function decodeBoxedTinToken(token: string): string | undefined {
  if (/^\d$/u.test(token)) {
    return token;
  }

  if (/^\d1$/u.test(token)) {
    return token[0];
  }

  return undefined;
}

function decodeMergedBoxedTinDigits(value: string): string | undefined {
  const digits = value.replace(/\D/gu, "");
  if (!digits) {
    return undefined;
  }

  let artifactCount = 0;
  let decoded = "";
  for (let index = 0; index < digits.length; index += 1) {
    decoded += digits[index];
    if (digits[index + 1] === "1") {
      artifactCount += 1;
      index += 1;
    }
  }

  return artifactCount > 0 ? decoded : undefined;
}

function decodeBoxedTinCell(cell: string): string | undefined {
  const rawTokens = cell.match(/\d+/gu) ?? [];
  if (rawTokens.length === 0) {
    return undefined;
  }

  const tokenDigits = rawTokens.map(decodeBoxedTinToken);
  if (tokenDigits.every((digit) => digit !== undefined)) {
    return tokenDigits.join("");
  }

  return decodeMergedBoxedTinDigits(cell);
}

function decodeBoxedTinTableCells(row: string): string | undefined {
  const tinLabel = /taxpayer identification number\s*\(tin\)/iu;
  const cells = splitMarkdownTableRow(row);
  const labelIndex = cells.findIndex((cell) => tinLabel.test(cell));
  if (labelIndex < 0) {
    return undefined;
  }

  const valueCells = cells
    .slice(labelIndex + 1)
    .filter((cell) => /\d/u.test(cell) && !/^-+$/u.test(cell));
  if (valueCells.length < 3) {
    return undefined;
  }

  const decodedCells = valueCells.map(decodeBoxedTinCell);
  if (decodedCells.some((cell) => cell === undefined)) {
    return undefined;
  }

  const decoded = decodedCells.join("");
  return CANONICAL_TIN_LENGTHS.has(decoded.length) ? decoded : undefined;
}

function decodeBoxedTinRow(row: string): string | undefined {
  const tinLabel = /taxpayer identification number\s*\(tin\)/iu;
  const decodedFromCells = decodeBoxedTinTableCells(row);
  if (decodedFromCells) {
    return decodedFromCells;
  }

  const labelMatch = tinLabel.exec(row);
  if (!labelMatch) {
    return undefined;
  }

  const rawTokens =
    row.slice(labelMatch.index + labelMatch[0].length).match(/\d+/gu) ?? [];
  const digits = rawTokens.map(decodeBoxedTinToken);

  if (digits.length === 0 || digits.some((digit) => digit === undefined)) {
    return undefined;
  }

  const decoded = digits.join("");
  return CANONICAL_TIN_LENGTHS.has(decoded.length) ? decoded : undefined;
}

function getTinRowItemNumber(field: "payeeTin" | "payorTin"): string {
  return field === "payeeTin" ? "2" : "6";
}

function extractBoxedTinFromOcrText(
  field: "payeeTin" | "payorTin",
  ocrText: string,
): string | undefined {
  const itemNumber = getTinRowItemNumber(field);
  const itemLabel = new RegExp(
    `^\\s*\\|?\\s*${itemNumber}\\s+Taxpayer Identification Number\\s*\\(TIN\\)`,
    "iu",
  );

  for (const row of ocrText.replace(/\\n/gu, "\n").split(/\r?\n/u)) {
    if (!itemLabel.test(row)) {
      continue;
    }

    const tin = decodeBoxedTinRow(row);
    if (tin) {
      return tin;
    }
  }

  return undefined;
}

function toPartyTinStringOrUndefined(
  value: unknown,
  field: "payeeTin" | "payorTin",
  ocrText: string,
): string | undefined {
  return (
    extractBoxedTinFromOcrText(field, ocrText) ?? toTinStringOrUndefined(value)
  );
}

export function createAzureNormalizerClient(config: NormalizerConfig): {
  normalize: (input: NormalizerInput) => Promise<NormalizedResult>;
} {
  const deployment = config.deploymentName ?? "gpt-4.1";
  const apiVersion = normalizeAzureApiVersion(config.apiVersion);
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
      assertStructuredOutputsApiVersion(apiVersion);

      const startedAt = new Date().toISOString();
      const promptPayload = buildNormalizerPromptPayload(input);
      const promptPayloadJson = JSON.stringify(promptPayload);

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
            response_format: AZURE_NORMALIZER_RESPONSE_FORMAT,
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

          if (
            isStructuredOutputsRequestError(error) &&
            error instanceof Error
          ) {
            logger?.warn("Azure normalizer Structured Outputs request failed", {
              sourceFileId: input.sourceFileId,
              revision: input.revision,
              deployment,
              apiVersion,
              error: error.message,
            });
            throw toStructuredOutputsRequestError(error, {
              apiVersion,
              deployment,
            });
          }

          throw error;
        });

      console.log({ response });

      if (!response.choices?.length) {
        logger?.warn("Azure normalizer request returned no choices", {
          sourceFileId: input.sourceFileId,
          revision: input.revision,
        });
        throw new Error("Azure normalizer request returned no choices");
      }

      const choice = response.choices[0];
      if (choice?.finish_reason === "length") {
        throw new Error(
          "Azure normalizer Structured Outputs response was truncated before completion",
        );
      }

      const refusal = choice?.message?.refusal;
      if (typeof refusal === "string" && refusal.trim().length > 0) {
        throw new Error(`Azure normalizer refused to normalize: ${refusal}`);
      }

      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("Azure normalizer returned empty structured content");
      }

      const normalized = parseJsonPayload(content);
      console.log({ normalized });
      const elapsedMs = Date.now() - Date.parse(startedAt);

      const taxBase = parseMoney(normalized.taxBase);
      const taxWithheld = parseMoney(normalized.taxWithheld);
      const atcCode = toStringOrUndefined(normalized.atcCode);
      const ocrText = [
        promptPayload.ocr.main.text,
        ...promptPayload.ocr.zoneFallback.blocks.map((block) => block.content),
      ].join("\n");
      const periodStart = normalizePeriodStartValue(
        normalized.periodStart ?? normalized.periodCovered,
      );
      const periodEnd = normalizePeriodEndValue(
        normalized.periodEnd ?? normalized.periodCovered,
      );
      const normalizedPeriodCovered = normalizePeriodCoveredValue(
        normalized.periodCovered,
      );
      const periodCovered =
        (normalizedPeriodCovered?.includes(" to ")
          ? normalizedPeriodCovered
          : undefined) ??
        buildPeriodCoveredValue(periodStart, periodEnd) ??
        normalizedPeriodCovered;
      const monthOfQuarter =
        toMonthOfQuarterOrUndefined(normalized.monthOfQuarter) ??
        inferMonthOfQuarterFromTaxBasePlacement({
          atcCode,
          ocrText,
          taxBase,
        });
      const payeeName = toStringOrUndefined(normalized.payeeName);
      const payeeTin = toPartyTinStringOrUndefined(
        normalized.payeeTin,
        "payeeTin",
        ocrText,
      );
      const payeeAddress = toStringOrUndefined(normalized.payeeAddress);
      const payeeZip = toStringOrUndefined(normalized.payeeZip);
      const payorName = toStringOrUndefined(normalized.payorName);
      const payorTin = toPartyTinStringOrUndefined(
        normalized.payorTin,
        "payorTin",
        ocrText,
      );
      const payorAddress = toStringOrUndefined(normalized.payorAddress);
      const payorZip = toStringOrUndefined(normalized.payorZip);
      const printedName = toStringOrUndefined(normalized.printedName);
      const signatoryTitle = toStringOrUndefined(normalized.signatoryTitle);
      const signatoryTin = toTinStringOrUndefined(normalized.signatoryTin);
      const signaturePresent = toBooleanOrUndefined(
        normalized.signaturePresent,
      );
      const companyName = toStringOrUndefined(normalized.companyName);
      const legacySignature = normalized.signature;
      const confidenceMap = sanitizeConfidenceMap(normalized.confidences);
      const tokenUsage = getTokenUsageSummary(response.usage);

      return {
        fields: {
          periodStart,
          periodCovered,
          periodEnd,
          monthOfQuarter,
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
            normalizerResponseFormat: "json_schema",
            normalizerResponseSchemaName: NORMALIZER_RESPONSE_SCHEMA_NAME,
            normalizerResponseSchemaVersion: NORMALIZER_RESPONSE_SCHEMA_VERSION,
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
