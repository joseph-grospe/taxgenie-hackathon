import type { Logger } from "@taxtrack/shared";
import type { NormalizedFields, ExtractionPayload } from "../types";
import { AzureOpenAI } from "openai";

export interface NormalizerConfig {
  apiKey: string;
  endpoint: string;
  deploymentName?: string;
  apiVersion?: string;
  timeoutMs?: number;
  logger?: Logger;
}

interface NormalizerInput {
  extraction: ExtractionPayload;
  sourceFileId: string;
  revision: string;
}

export interface NormalizedResult {
  fields: NormalizedFields;
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

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function toStringOrBooleanOrUndefined(value: unknown): string | boolean | undefined {
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

    return trimmed;
  }

  return undefined;
}

export function createAzureNormalizerClient(config: NormalizerConfig): {
  normalize: (input: NormalizerInput) => Promise<NormalizedResult>;
} {
  const deployment = config.deploymentName ?? "gpt-4.1";
  const apiVersion = config.apiVersion ?? "2024-04-01-preview";
  const logger = config.logger;
  const endpoint = config.endpoint.replace(/\/+$/u, "");

  const client = new AzureOpenAI({
    apiKey: config.apiKey,
    apiVersion,
    endpoint,
    deployment
  });
  const systemPrompt = `You are a tax document extraction normalizer.
Return strict JSON only with keys:
periodCovered, periodEnd, payeeName, payeeTin, payorName, payorTin,
atcCode, taxBase, taxWithheld, printedName, signature, companyName, confidences.
Use null when unknown and keep values as strings/numbers/booleans.`;

  return {
    async normalize(input: NormalizerInput): Promise<NormalizedResult> {
      const startedAt = new Date().toISOString();
      const response = await client.chat.completions.create({
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: JSON.stringify({
              sourceFileId: input.sourceFileId,
              revision: input.revision,
              extractionStartedAt: input.extraction.startedAt,
              extractionProvider: input.extraction.provider,
              extractionMetadata: input.extraction.metadata,
              extractedText: input.extraction.parsedText ?? "",
              extractedPayload: input.extraction.raw
            })
          }
        ],
        model: deployment,
        temperature: 0.1,
        max_tokens: 2048,
        top_p: 1,
        response_format: {
          type: "json_object"
        }
      });

      if (!response.choices?.length) {
        logger?.warn("Azure normalizer request returned no choices", {
          sourceFileId: input.sourceFileId,
          revision: input.revision
        });
        throw new Error("Azure normalizer request returned no choices");
      }

      const content = response.choices?.[0]?.message?.content ?? "{}";
      const normalized = parseJsonPayload(content);
      const elapsedMs = Date.now() - Date.parse(startedAt);

      const taxBase = normalized.taxBase === undefined ? undefined : Number(normalized.taxBase);
      const taxWithheld = normalized.taxWithheld === undefined ? undefined : Number(normalized.taxWithheld);
      const atcCode = toStringOrUndefined(normalized.atcCode);
      const periodCovered = toStringOrUndefined(normalized.periodCovered);
      const periodEnd = toStringOrUndefined(normalized.periodEnd);
      const payeeName = toStringOrUndefined(normalized.payeeName);
      const payeeTin = toStringOrUndefined(normalized.payeeTin);
      const payorName = toStringOrUndefined(normalized.payorName);
      const payorTin = toStringOrUndefined(normalized.payorTin);
      const printedName = toStringOrBooleanOrUndefined(normalized.printedName);
      const signature = toStringOrBooleanOrUndefined(normalized.signature);
      const companyName = toStringOrUndefined(normalized.companyName);
      const confidenceMap = normalized.confidences as Record<string, number> | undefined;

      return {
        fields: {
          periodCovered,
          periodEnd,
          payeeName,
          payeeTin,
          payorName,
          payorTin,
          atcCode,
          taxBase: Number.isFinite(taxBase) ? taxBase : undefined,
          taxWithheld: Number.isFinite(taxWithheld) ? taxWithheld : undefined,
          printedName,
          signature,
          companyName,
          confidenceMap,
          normalizedFrom: "azure-openai",
          normalizedAt: new Date().toISOString(),
          normalizerElapsedMs: elapsedMs,
          normalizerPayload: {
            sourceFileId: input.sourceFileId,
            revision: input.revision,
            extractionAt: input.extraction.startedAt,
            metadata: input.extraction.metadata
          }
        }
      };
    }
  };
}
