import type { Logger } from "@taxtrack/shared";
import type { ExtractionPayload } from "../types";

export interface MistralConfig {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  timeoutMs?: number;
  logger?: Logger;
}

interface MistralRequest {
  sourceFileId: string;
  revision: string;
  mimeType: string;
  content: Buffer;
}

interface MistralResponse {
  raw: Record<string, unknown>;
}

function parseMoneySource(raw: unknown): MistralResponse["raw"] {
  if (typeof raw === "object" && raw !== null) {
    return raw as MistralResponse["raw"];
  }

  return { data: raw };
}

export interface MistralExtractionClient {
  extract(state: MistralRequest): Promise<ExtractionPayload>;
}

export function createMistralClient(config: MistralConfig): MistralExtractionClient {
  if (!config.apiUrl) {
    throw new Error("MISTRAL_API_URL is required for OCR extraction");
  }

  const apiUrl = config.apiUrl.replace(/\/+$/u, "");
  const model = config.model ?? "mistral-document-ai-2505";
  const logger = config.logger;

  const normalizeMimeType = (mimeType: string): string => {
    const trimmed = mimeType.trim().toLowerCase();
    if (!trimmed) {
      return "application/pdf";
    }

    if (trimmed.startsWith("application/pdf")) {
      return "application/pdf";
    }

    if (trimmed.startsWith("image/")) {
      return trimmed;
    }

    return "application/pdf";
  };

  return {
    async extract(state: MistralRequest): Promise<ExtractionPayload> {
      const startedAt = new Date().toISOString();
      const payloadBase64 = state.content.toString("base64");
      const started = Date.now();
      const normalizedMimeType = normalizeMimeType(state.mimeType);
      const isPdf = normalizedMimeType === "application/pdf";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          document: {
            type: isPdf ? "document_url" : "image_url",
            [isPdf ? "document_url" : "image_url"]: `data:${normalizedMimeType};base64,${payloadBase64}`
          },
          include_image_base64: true
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 60000)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger?.warn("Mistral OCR request failed", {
          sourceFileId: state.sourceFileId,
          revision: state.revision,
          status: response.status,
          body: errorBody
        });
        throw new Error(`Mistral OCR request failed: ${response.status}`);
      }

      const raw = await response
        .json()
        .then((value) => parseMoneySource(value))
        .catch(async () => {
          const text = await response.text();
          return { rawText: text };
        });

      const extractedText =
        (typeof (raw as { text?: unknown }).text === "string" ? (raw as { text?: string }).text : undefined) ??
        (typeof (raw as { extractedText?: unknown }).extractedText === "string" ? (raw as { extractedText?: string }).extractedText : undefined) ??
        (typeof (raw as { content?: unknown }).content === "string" ? (raw as { content?: string }).content : undefined) ??
        (typeof (raw as { rawText?: unknown }).rawText === "string" ? (raw as { rawText?: string }).rawText : undefined);

      const durationMs = Date.now() - started;
      return {
        provider: "mistral-ocr",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        raw,
        parsedText: extractedText,
        metadata: {
          model,
          sourceFileId: state.sourceFileId,
          revision: state.revision,
          elapsedMs: durationMs,
          requestStatus: "ok"
        }
      };
    }
  };
}
