import type { Logger } from "@taxtrack/shared";
import type { MistralExtractionClient } from "../services/mistralClient";
import type { ExtractionPayload } from "../types";
import { getExtractionPlainText, getExtractionText } from "./pageProcessing";
import {
  appendZoneOcrText,
  assessZoneOcrNeeds,
  BIR_2307_ZONES,
  type Bir2307ZoneId,
} from "./zoneOcr";
import type { PdfZoneRenderer } from "./pdfZoneRenderer";

export interface ZoneOcrFallbackConfig {
  enabled: boolean;
  maxZonesPerPage: number;
  singlePageRescueEnabled: boolean;
}

export interface ZoneOcrFallbackInput {
  extraction: ExtractionPayload;
  pageContent: Buffer;
  pageNumber: number;
  totalPages: number;
  sourceFileId: string;
  revision: string;
  likelyCertificate: boolean;
}

export interface ZoneOcrFallbackDeps {
  config: ZoneOcrFallbackConfig;
  renderer: PdfZoneRenderer;
  ocrClient: MistralExtractionClient;
  logger: Logger;
}

interface ZoneFailure {
  zoneId: Bir2307ZoneId;
  error: string;
}

function zoneMetadataBase(input: ZoneOcrFallbackInput, result: ReturnType<typeof assessZoneOcrNeeds>) {
  return {
    pageNumber: input.pageNumber,
    triggeredZones: result.triggeredZones,
    skippedZones: result.skippedZones,
    weakBir2307Signal: result.weakBir2307Signal,
    likelyCertificate: result.likelyCertificate,
    incompleteMainOcr: result.incompleteMainOcr,
  };
}

function getZoneExtractionText(extraction: ExtractionPayload): string {
  return extraction.parsedText?.trim() || getExtractionText(extraction);
}

function getZoneExtractionMarkdown(extraction: ExtractionPayload): string {
  return getExtractionPlainText(extraction)?.trim() || getZoneExtractionText(extraction);
}

export async function applyZoneOcrFallback(
  input: ZoneOcrFallbackInput,
  deps: ZoneOcrFallbackDeps,
): Promise<ExtractionPayload> {
  if (!deps.config.enabled) {
    return {
      ...input.extraction,
      metadata: {
        ...input.extraction.metadata,
        zoneOcrFallback: {
          status: "disabled",
          pageNumber: input.pageNumber,
        },
      },
    };
  }

  const zoneNeeds = assessZoneOcrNeeds({
    extraction: input.extraction,
    likelyCertificate: input.likelyCertificate,
    isSinglePage: input.totalPages === 1,
    singlePageRescueEnabled: deps.config.singlePageRescueEnabled,
    maxZones: deps.config.maxZonesPerPage,
  });

  if (zoneNeeds.triggeredZones.length === 0) {
    return {
      ...input.extraction,
      metadata: {
        ...input.extraction.metadata,
        zoneOcrFallback: {
          ...zoneMetadataBase(input, zoneNeeds),
          status: "skipped",
          appended: false,
          failures: [],
          zones: [],
        },
      },
    };
  }

  const blocks: Array<{
    zoneId: Bir2307ZoneId;
    text: string;
    markdown?: string;
  }> = [];
  const zoneMetadata: Array<Record<string, unknown>> = [];
  const failures: ZoneFailure[] = [];

  for (const zoneId of zoneNeeds.triggeredZones) {
    const zone = BIR_2307_ZONES.find((item) => item.id === zoneId);
    if (!zone) {
      continue;
    }

    try {
      const rendered = await deps.renderer.render({
        content: input.pageContent,
        zone,
        sourceFileId: input.sourceFileId,
        revision: `${input.revision}-page-${input.pageNumber}-zone-${zone.id}`,
        pageNumber: input.pageNumber,
      });
      const started = Date.now();
      const zoneExtraction = await deps.ocrClient.extract({
        sourceFileId: input.sourceFileId,
        revision: `${input.revision}-page-${input.pageNumber}-zone-${zone.id}`,
        mimeType: rendered.mimeType,
        content: rendered.content,
      });
      const text = getZoneExtractionText(zoneExtraction);
      const markdown = getZoneExtractionMarkdown(zoneExtraction);

      blocks.push({ zoneId, text, markdown });
      zoneMetadata.push({
        zoneId,
        label: zone.label,
        render: rendered.metadata,
        ocrElapsedMs: Date.now() - started,
        ocrMetadata: zoneExtraction.metadata,
        appendedTextLength: text.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ zoneId, error: message });
      deps.logger.warn("Zone OCR fallback failed", {
        sourceFileId: input.sourceFileId,
        revision: input.revision,
        pageNumber: input.pageNumber,
        zoneId,
        error: message,
      });
    }
  }

  const enriched = appendZoneOcrText(input.extraction, blocks);
  const appended = enriched !== input.extraction;

  return {
    ...enriched,
    metadata: {
      ...enriched.metadata,
      zoneOcrFallback: {
        ...zoneMetadataBase(input, zoneNeeds),
        status: failures.length === zoneNeeds.triggeredZones.length ? "failed" : "completed",
        appended,
        zones: zoneMetadata,
        failures,
      },
    },
  };
}
