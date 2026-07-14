import type { Logger } from "@taxtrack/shared";
import type { MistralExtractionClient } from "../services/mistralClient";
import type { ExtractionPayload } from "../types";
import type { SignatureVisualDetectionResult } from "./signatureVisualDetector";
import {
  appendZoneOcrText,
  assessZoneOcrNeeds,
  BIR_2307_ZONES,
  getBir2307ZoneOcrCandidates,
  getZoneOcrBlockDiscardReason,
  type Bir2307ZoneId,
  type Bir2307ZoneOcrCandidate,
} from "./zoneOcr";
import type { PdfZoneRenderer } from "./pdfZoneRenderer";
import { getDocumentAnnotation } from "../services/normalizerPostProcessing";

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
  signatureVisualDetection?: SignatureVisualDetectionResult;
}

export interface ZoneOcrFallbackDeps {
  config: ZoneOcrFallbackConfig;
  renderer: PdfZoneRenderer;
  ocrClient: MistralExtractionClient;
  logger: Logger;
}

interface ZoneFailure {
  zoneId: Bir2307ZoneId;
  candidateId?: string;
  candidateSource?: "fixed" | "visual_anchor";
  candidateIndex?: number;
  error: string;
}

const SIGNER_FIELD_LOW_CONFIDENCE_THRESHOLD = 0.2;

function buildOcrPreview(text: string, markdown: string): string | undefined {
  const preview = [text, markdown]
    .find((value) => value.trim().length > 0)
    ?.replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);

  return preview && preview.length > 0 ? preview : undefined;
}

function zoneMetadataBase(
  input: ZoneOcrFallbackInput,
  result: ReturnType<typeof assessZoneOcrNeeds>,
) {
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
  return (
    firstNonEmptyString([
      extraction.parsedText,
      extraction.raw.text,
      extraction.raw.extractedText,
      extraction.raw.content,
      extraction.raw.rawText,
      collectZonePageText(extraction.raw, ["text", "markdown", "content"]),
    ]) ?? ""
  );
}

function getZoneExtractionMarkdown(extraction: ExtractionPayload): string {
  return (
    firstNonEmptyString([
      collectZonePageText(extraction.raw, ["markdown", "text", "content"]),
      getZoneExtractionText(extraction),
    ]) ?? ""
  );
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function collectZonePageText(
  raw: Record<string, unknown>,
  fields: Array<"markdown" | "text" | "content">,
): string | undefined {
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  const text = pages
    .filter(
      (page): page is Record<string, unknown> =>
        typeof page === "object" && page !== null && !Array.isArray(page),
    )
    .map((page) => firstNonEmptyString(fields.map((field) => page[field])))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function buildZoneRevision(
  input: ZoneOcrFallbackInput,
  zone: Bir2307ZoneOcrCandidate,
): string {
  const baseRevision = `${input.revision}-page-${input.pageNumber}-zone-${zone.id}`;
  return zone.candidateId
    ? `${baseRevision}-candidate-${zone.candidateId}`
    : baseRevision;
}

function hasTrustedPrintedName(
  annotation: Record<string, unknown> | undefined,
): boolean {
  if (!annotation) {
    return false;
  }

  const printedName = annotation.printedName;
  if (typeof printedName !== "string" || printedName.trim().length === 0) {
    return false;
  }

  const confidences = annotation.confidences ?? annotation.confidenceMap;
  if (
    typeof confidences === "object" &&
    confidences !== null &&
    !Array.isArray(confidences)
  ) {
    const confidence = (confidences as Record<string, unknown>).printedName;
    if (
      typeof confidence === "number" &&
      confidence <= SIGNER_FIELD_LOW_CONFIDENCE_THRESHOLD
    ) {
      return false;
    }
  }

  return true;
}

function hasSignerRecoveryVisualEvidence(
  detection: SignatureVisualDetectionResult | undefined,
): boolean {
  return Boolean(
    detection?.signaturePresent === true ||
      (detection?.anchorOcrEligible === true &&
        detection.structure?.payorSignerBandVisible === true),
  );
}

function getForcedZoneOcrFallbackZones(
  input: ZoneOcrFallbackInput,
): Bir2307ZoneId[] {
  if (!hasSignerRecoveryVisualEvidence(input.signatureVisualDetection)) {
    return [];
  }

  const annotation = getDocumentAnnotation(input.extraction.raw);
  if (!annotation || hasTrustedPrintedName(annotation)) {
    return [];
  }

  return ["signature_block"];
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
    forcedZones: getForcedZoneOcrFallbackZones(input),
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
  const discardedZones: Array<Record<string, unknown>> = [];
  const failures: ZoneFailure[] = [];
  const failedZoneIds = new Set<Bir2307ZoneId>();

  for (const zoneId of zoneNeeds.triggeredZones) {
    const zone = BIR_2307_ZONES.find((item) => item.id === zoneId);
    if (!zone) {
      continue;
    }

    const candidates = getBir2307ZoneOcrCandidates(zone, {
      signatureVisualDetection: input.signatureVisualDetection,
    });
    let zoneHadUsableText = false;
    let zoneHadNonFailure = false;

    for (const [candidateOffset, candidate] of candidates.entries()) {
      const candidateIndex = candidateOffset + 1;
      const candidateCount = candidates.length;
      const revision = buildZoneRevision(input, candidate);

      try {
        const rendered = await deps.renderer.render({
          content: input.pageContent,
          zone: candidate,
          sourceFileId: input.sourceFileId,
          revision,
          pageNumber: input.pageNumber,
        });
        const started = Date.now();
        const zoneExtraction = await deps.ocrClient.extract({
          sourceFileId: input.sourceFileId,
          revision,
          mimeType: rendered.mimeType,
          content: rendered.content,
          requestProfile:
            zoneId === "signature_block"
              ? "signature_block_annotation"
              : "zone_text",
        });
        const text = getZoneExtractionText(zoneExtraction);
        const markdown = getZoneExtractionMarkdown(zoneExtraction);
        const discardReason = getZoneOcrBlockDiscardReason({
          zoneId,
          text,
          markdown,
        });
        const fallbackAnnotation = getDocumentAnnotation(zoneExtraction.raw);
        const discardedPreview = discardReason
          ? buildOcrPreview(text, markdown)
          : undefined;

        zoneHadNonFailure = true;

        if (discardReason) {
          discardedZones.push({
            zoneId,
            candidateId: candidate.candidateId,
            candidateSource: candidate.candidateSource,
            candidateIndex,
            reason: discardReason,
            textLength: text.length,
            markdownLength: markdown.length,
            preview: discardedPreview,
          });
        } else {
          blocks.push({ zoneId, text, markdown });
          zoneHadUsableText = true;
        }
        zoneMetadata.push({
          zoneId,
          label: candidate.label,
          candidateId: candidate.candidateId,
          candidateSource: candidate.candidateSource,
          candidateIndex,
          candidateCount,
          render: rendered.metadata,
          ocrElapsedMs: Date.now() - started,
          ocrMetadata: zoneExtraction.metadata,
          appendedTextLength: discardReason ? 0 : text.length,
          rawTextLength: text.length,
          rawMarkdownLength: markdown.length,
          discardedReason: discardReason,
          discardedPreview,
          fallbackAnnotation,
        });

        if (zoneHadUsableText) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          zoneId,
          candidateId: candidate.candidateId,
          candidateSource: candidate.candidateSource,
          candidateIndex,
          error: message,
        });
        deps.logger.warn("Zone OCR fallback failed", {
          sourceFileId: input.sourceFileId,
          revision: input.revision,
          pageNumber: input.pageNumber,
          zoneId,
          candidateId: candidate.candidateId,
          candidateIndex,
          error: message,
        });
      }
    }

    if (!zoneHadUsableText && !zoneHadNonFailure) {
      failedZoneIds.add(zoneId);
    }
  }

  const enriched = appendZoneOcrText(input.extraction, blocks);
  const appended = enriched !== input.extraction;
  const allTriggeredZonesFailed =
    zoneNeeds.triggeredZones.length > 0 &&
    zoneNeeds.triggeredZones.every((zoneId) => failedZoneIds.has(zoneId));

  return {
    ...enriched,
    metadata: {
      ...enriched.metadata,
      zoneOcrFallback: {
        ...zoneMetadataBase(input, zoneNeeds),
        status: allTriggeredZonesFailed
          ? "failed"
          : blocks.length === 0
            ? "completed_no_usable_text"
            : "completed",
        appended,
        zones: zoneMetadata,
        discardedZones,
        failures,
      },
    },
  };
}
