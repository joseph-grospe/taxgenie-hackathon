import type { ExtractionPayload, WorkflowPageState } from "../types";
import { getMainExtractionPlainText } from "./pageProcessing";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function toZoneFallbackBlocks(raw: JsonRecord): Array<{
  zoneId: string;
  text: string;
  markdown: string;
}> {
  const blocks = raw.zoneOcrFallbackText;
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .filter(isRecord)
    .map((block) => ({
      zoneId: toStringValue(block.zoneId) ?? "unknown",
      text: toStringValue(block.text) ?? "",
      markdown:
        toStringValue(block.markdown) ?? toStringValue(block.text) ?? "",
    }))
    .filter((block) => block.text.length > 0);
}

function toPageSummaries(raw: JsonRecord): Array<{
  index: number | null;
  dimensions?: unknown;
  imageCount: number;
  tableCount: number;
  markdown: string;
  markdownLength: number;
}> {
  const pages = Array.isArray(raw.pages) ? raw.pages : [];

  return pages.filter(isRecord).map((page) => ({
    index: typeof page.index === "number" ? page.index : null,
    dimensions: page.dimensions,
    imageCount: Array.isArray(page.images) ? page.images.length : 0,
    tableCount: Array.isArray(page.tables) ? page.tables.length : 0,
    markdown: toStringValue(page.markdown) ?? "",
    markdownLength:
      typeof page.markdown === "string" ? page.markdown.length : 0,
  }));
}

function toZoneFallbackSummary(metadata: JsonRecord): JsonRecord {
  const zoneOcrFallback = toRecord(metadata.zoneOcrFallback);
  if (!zoneOcrFallback) {
    return { status: "not_run", blocks: [] };
  }

  return {
    status: zoneOcrFallback.status ?? "unknown",
    triggeredZones: zoneOcrFallback.triggeredZones ?? [],
    skippedZones: zoneOcrFallback.skippedZones ?? [],
    failures: zoneOcrFallback.failures ?? [],
    pageNumber: zoneOcrFallback.pageNumber,
    weakBir2307Signal: zoneOcrFallback.weakBir2307Signal,
    likelyCertificate: zoneOcrFallback.likelyCertificate,
    incompleteMainOcr: zoneOcrFallback.incompleteMainOcr,
  };
}

export function buildOcrEvidencePayload(
  extraction: ExtractionPayload | undefined,
) {
  if (!extraction) {
    return undefined;
  }

  const raw = extraction.raw;
  const metadata = extraction.metadata ?? {};

  return {
    provider: extraction.provider,
    startedAt: extraction.startedAt,
    finishedAt: extraction.finishedAt,
    durationMs: extraction.durationMs,
    main: {
      role: "main_full_page_ocr",
      text: getMainExtractionPlainText(extraction) ?? "",
      pages: toPageSummaries(raw),
    },
    zoneFallback: {
      role: "targeted_zone_fallback",
      ...toZoneFallbackSummary(metadata),
      blocks: toZoneFallbackBlocks(raw),
    },
    providerSummary: {
      model: raw.model,
      usageInfo: raw.usage_info,
      metadata,
    },
  };
}

export function buildPersistedPagePayload(page: WorkflowPageState) {
  return {
    pageNumber: page.pageNumber,
    classification: page.classification,
    ocr: buildOcrEvidencePayload(page.extraction),
    normalized: page.normalized,
    masterlistLookup: page.masterlistLookup,
    validation: page.validation,
    decision: page.decision,
  };
}
