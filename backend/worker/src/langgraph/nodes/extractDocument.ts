import {
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
  type Logger,
} from "@taxtrack/shared";
import type {
  NormalizedFields,
  ValidationResult,
  WorkflowPageState,
  WorkflowState,
} from "../types";
import type { MistralExtractionClient } from "../services/mistralClient";
import {
  getDocumentAnnotation,
  postProcessNormalizedFields,
} from "../services/normalizerPostProcessing";
import {
  classifyPageText,
  getExtractionText,
  splitPdfPages,
} from "../utils/pageProcessing";
import type { PdfZoneRenderer } from "../utils/pdfZoneRenderer";
import type {
  SignatureVisualDetectionResult,
  SignatureVisualDetector,
} from "../utils/signatureVisualDetector";
import {
  applyZoneOcrFallback,
  type ZoneOcrFallbackConfig,
} from "../utils/zoneOcrFallback";

interface ExtractDocumentDeps {
  ocrClient: MistralExtractionClient;
  signatureVisualDetector?: SignatureVisualDetector;
  zoneRenderer?: PdfZoneRenderer;
  zoneOcrConfig?: ZoneOcrFallbackConfig;
  logger: Logger;
}

function buildErrorValidation(
  reason: string,
  code: string,
  message: string,
): ValidationResult {
  return {
    status: "invalid",
    reasons: [reason],
    checks: [
      {
        code,
        passed: false,
        message,
      },
    ],
  };
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function metadataNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SIGNATURE_BLOCK_SIGNER_FIELDS = [
  "printedName",
  "signatoryTitle",
  "signatoryTin",
] as const;

function getSignatureBlockFallbackAnnotation(
  extraction: NonNullable<WorkflowPageState["extraction"]>,
): Record<string, unknown> | undefined {
  const zoneOcrFallback = isRecord(extraction.metadata.zoneOcrFallback)
    ? extraction.metadata.zoneOcrFallback
    : undefined;
  const zones = Array.isArray(zoneOcrFallback?.zones)
    ? zoneOcrFallback.zones
    : [];

  for (const zone of zones) {
    if (
      !isRecord(zone) ||
      zone.zoneId !== "signature_block" ||
      zone.discardedReason
    ) {
      continue;
    }

    if (isRecord(zone.fallbackAnnotation)) {
      return zone.fallbackAnnotation;
    }
  }

  return undefined;
}

function mergeSignatureBlockSignerAnnotation(input: {
  annotation: Record<string, unknown>;
  signatureBlockAnnotation: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  if (!input.signatureBlockAnnotation) {
    return input.annotation;
  }

  const nextAnnotation = { ...input.annotation };
  const sourceConfidences =
    isRecord(input.signatureBlockAnnotation.confidences) ||
    isRecord(input.signatureBlockAnnotation.confidenceMap)
      ? ((input.signatureBlockAnnotation.confidences ??
          input.signatureBlockAnnotation.confidenceMap) as Record<
          string,
          unknown
        >)
      : undefined;
  const nextConfidences = isRecord(input.annotation.confidences)
    ? { ...input.annotation.confidences }
    : isRecord(input.annotation.confidenceMap)
      ? { ...input.annotation.confidenceMap }
      : {};
  let mergedConfidence = false;

  for (const field of SIGNATURE_BLOCK_SIGNER_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(
        input.signatureBlockAnnotation,
        field,
      )
    ) {
      nextAnnotation[field] = input.signatureBlockAnnotation[field];
    }

    if (
      sourceConfidences &&
      Object.prototype.hasOwnProperty.call(sourceConfidences, field)
    ) {
      nextConfidences[field] = sourceConfidences[field];
      mergedConfidence = true;
    }
  }

  if (mergedConfidence || isRecord(input.annotation.confidences)) {
    nextAnnotation.confidences = nextConfidences;
  }

  return nextAnnotation;
}

type SignatureVisualPrecheck =
  | {
      status: "detected" | "not_detected";
      detection: SignatureVisualDetectionResult;
    }
  | {
      status: "failed";
      error: string;
    };

function attachSignatureVisualFallback(
  fields: NormalizedFields,
  fallback:
    | {
        status: "detected" | "not_detected";
        promoted: boolean;
        detection: SignatureVisualDetectionResult;
      }
    | {
        status: "failed";
        promoted: false;
        error: string;
      },
): NormalizedFields {
  const normalizerPayload = isRecord(fields.normalizerPayload)
    ? { ...fields.normalizerPayload }
    : {};
  const nextFields: NormalizedFields = {
    ...fields,
    normalizerPayload: {
      ...normalizerPayload,
      signatureVisualFallback: fallback,
    },
  };

  if (fallback.status !== "detected" || !fallback.promoted) {
    return nextFields;
  }

  const confidenceMap = isRecord(fields.confidenceMap)
    ? { ...fields.confidenceMap }
    : {};

  return {
    ...nextFields,
    signaturePresent: true,
    signature: true,
    confidenceMap: {
      ...confidenceMap,
      signaturePresent: Math.max(
        Number(confidenceMap.signaturePresent ?? 0),
        fallback.detection.confidence,
      ),
    },
  };
}

async function detectSignatureVisualFallback(input: {
  detector: SignatureVisualDetector | undefined;
  pageContent: Buffer;
  sourceFileId: string;
  revision: string;
  pageNumber: number;
  logger: Logger;
}): Promise<SignatureVisualPrecheck | undefined> {
  if (!input.detector) {
    return undefined;
  }

  try {
    const detection = await input.detector.detect({
      content: input.pageContent,
      sourceFileId: input.sourceFileId,
      revision: input.revision,
      pageNumber: input.pageNumber,
    });

    return {
      status: detection.status,
      detection,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn("Signature visual fallback failed", {
      sourceFileId: input.sourceFileId,
      revision: input.revision,
      pageNumber: input.pageNumber,
      error: message,
    });

    return {
      status: "failed",
      error: message,
    };
  }
}

function applySignatureVisualFallback(input: {
  fields: NormalizedFields;
  visualPrecheck: SignatureVisualPrecheck | undefined;
}): NormalizedFields {
  if (!input.visualPrecheck) {
    return input.fields;
  }

  if (input.visualPrecheck.status === "failed") {
    return attachSignatureVisualFallback(input.fields, {
      status: "failed",
      promoted: false,
      error: input.visualPrecheck.error,
    });
  }

  const promoted =
    input.visualPrecheck.detection.signaturePresent &&
    input.fields.signaturePresent !== true;

  return attachSignatureVisualFallback(input.fields, {
    status: input.visualPrecheck.detection.status,
    promoted,
    detection: input.visualPrecheck.detection,
  });
}

function buildNormalizedFields(input: {
  extraction: NonNullable<WorkflowPageState["extraction"]>;
  annotation: Record<string, unknown>;
  sourceFileId: string;
  revision: string;
  signatureVisualDetection?: SignatureVisualDetectionResult;
}): NormalizedFields {
  const metadata = input.extraction.metadata;
  const normalizedAnnotation = mergeSignatureBlockSignerAnnotation({
    annotation: input.annotation,
    signatureBlockAnnotation: getSignatureBlockFallbackAnnotation(
      input.extraction,
    ),
  });

  return postProcessNormalizedFields({
    normalized: normalizedAnnotation,
    extraction: input.extraction,
    annotationRaw: input.extraction.raw,
    signatureVisualDetection: input.signatureVisualDetection,
    audit: {
      sourceFileId: input.sourceFileId,
      revision: input.revision,
      startedAt: input.extraction.startedAt,
      elapsedMs: input.extraction.durationMs,
      provider: "mistral-document-annotation",
      model: metadataString(metadata, "model") ?? input.extraction.provider,
      responseModel:
        metadataString(metadata, "responseModel") ??
        (typeof input.extraction.raw.model === "string"
          ? input.extraction.raw.model
          : undefined),
      requestPayloadChars: metadataNumber(metadata, "requestPayloadChars") ?? 0,
      annotationPayloadChars: JSON.stringify(normalizedAnnotation).length,
      usageInfo: metadata.usageInfo ?? input.extraction.raw.usage_info,
    },
  }).fields;
}

function buildArtifactKeys(state: WorkflowState) {
  return {
    ...state.artifactKeys,
    rawResultJson:
      state.artifactKeys?.rawResultJson ??
      buildProcessingArtifactKey({
        entityKey: buildOptionalEntityStorageKey(state.event.selectedEntity),
        batchId: state.event.batchId,
        uploadId: state.event.uploadId,
        revision: state.event.revision,
        fileName: "raw-extraction.json",
      }),
    finalResultJson:
      state.artifactKeys?.finalResultJson ??
      buildProcessingArtifactKey({
        entityKey: buildOptionalEntityStorageKey(state.event.selectedEntity),
        batchId: state.event.batchId,
        uploadId: state.event.uploadId,
        revision: state.event.revision,
        fileName: "final-result.json",
      }),
  };
}

export function createExtractDocumentNode(deps: ExtractDocumentDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    if (!state.source) {
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [
            ...(state.decision?.reasonCodes ?? []),
            "missing_source_metadata",
          ],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: buildErrorValidation(
          "missing_source_metadata",
          "MISSING_SOURCE_METADATA",
          "No source metadata available for extraction",
        ),
      };
    }

    if (!state.source.mimeType.toLowerCase().includes("pdf")) {
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [
            ...(state.decision?.reasonCodes ?? []),
            "non_pdf_input",
          ],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: buildErrorValidation(
          "non_pdf_input",
          "UNSUPPORTED_MIME_TYPE",
          `Unsupported mime type: ${state.source.mimeType}`,
        ),
      };
    }

    const sourceBody = state.sourceContentBase64
      ? Buffer.from(state.sourceContentBase64, "base64")
      : Buffer.from("");

    if (!sourceBody.length) {
      deps.logger.error(
        "OCR extraction cannot proceed with empty source body",
        {
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      );
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [
            ...(state.decision?.reasonCodes ?? []),
            "source_body_empty",
          ],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: buildErrorValidation(
          "source_body_empty",
          "SOURCE_BODY_EMPTY",
          "Source body is empty",
        ),
      };
    }

    const splitPages = await splitPdfPages(sourceBody);
    if (splitPages.length === 0) {
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "no_pdf_pages"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: buildErrorValidation(
          "no_pdf_pages",
          "NO_PDF_PAGES",
          "No pages were found in the uploaded PDF",
        ),
      };
    }

    const pages: WorkflowPageState[] = [];
    for (const page of splitPages) {
      const mainExtraction = await deps.ocrClient.extract({
        sourceFileId: state.event.sourceFileId,
        revision: `${state.event.revision}-page-${page.pageNumber}`,
        mimeType: "application/pdf",
        content: page.content,
      });
      const mainClassification = classifyPageText(
        getExtractionText(mainExtraction),
      );
      const signatureVisualPrecheck =
        mainClassification === "certificate"
          ? await detectSignatureVisualFallback({
              detector: deps.signatureVisualDetector,
              pageContent: page.content,
              sourceFileId: state.event.sourceFileId,
              revision: `${state.event.revision}-page-${page.pageNumber}`,
              pageNumber: page.pageNumber,
              logger: deps.logger,
            })
          : undefined;
      const extraction =
        deps.zoneRenderer && deps.zoneOcrConfig
          ? await applyZoneOcrFallback(
              {
                extraction: mainExtraction,
                pageContent: page.content,
                pageNumber: page.pageNumber,
                totalPages: splitPages.length,
                sourceFileId: state.event.sourceFileId,
                revision: state.event.revision,
                likelyCertificate: mainClassification === "certificate",
                signatureVisualDetection:
                  signatureVisualPrecheck?.status === "failed"
                    ? undefined
                    : signatureVisualPrecheck?.detection,
              },
              {
                config: deps.zoneOcrConfig,
                renderer: deps.zoneRenderer,
                ocrClient: deps.ocrClient,
                logger: deps.logger,
              },
            )
          : mainExtraction;
      const classification = classifyPageText(getExtractionText(extraction));
      const annotation = getDocumentAnnotation(extraction.raw);

      if (classification === "certificate" && !annotation) {
        const pageState: WorkflowPageState = {
          pageNumber: page.pageNumber,
          classification,
          sourceContentBase64: page.content.toString("base64"),
          extraction,
          extracted: extraction.raw,
        };
        const nextPages = [...pages, pageState];

        return {
          sourceContentBase64: undefined,
          pages: nextPages,
          extraction,
          extracted: extraction.raw,
          batchSummary: {
            totalPages: splitPages.length,
            certificatePageNumbers: [page.pageNumber],
            ignoredPageNumbers: pages
              .filter((item) => item.classification === "non_certificate")
              .map((item) => item.pageNumber),
            validPageNumbers: [],
            failedPageNumbers: [page.pageNumber],
            duplicatePageNumbers: [],
          },
          validation: buildErrorValidation(
            "missing_document_annotation",
            "MISSING_DOCUMENT_ANNOTATION",
            "OCR response did not include document annotation for the certificate page",
          ),
          decision: {
            terminalStatus: "Error",
            route: "error",
            reasonCodes: ["missing_document_annotation"],
            phase: "extract",
            sourceFileId: state.event.sourceFileId,
            revision: state.event.revision,
          },
          artifactKeys: buildArtifactKeys(state),
        };
      }

      const normalized =
        classification === "certificate" && annotation
          ? applySignatureVisualFallback({
              fields: buildNormalizedFields({
                extraction,
                annotation,
                sourceFileId: state.event.sourceFileId,
                revision: `${state.event.revision}-page-${page.pageNumber}`,
                signatureVisualDetection:
                  signatureVisualPrecheck?.status === "failed"
                    ? undefined
                    : signatureVisualPrecheck?.detection,
              }),
              visualPrecheck: signatureVisualPrecheck,
            })
          : undefined;

      pages.push({
        pageNumber: page.pageNumber,
        classification,
        sourceContentBase64: page.content.toString("base64"),
        extraction,
        extracted: extraction.raw,
        normalized,
      });
    }

    const certificatePageNumbers = pages
      .filter((page) => page.classification === "certificate")
      .map((page) => page.pageNumber);
    const ignoredPageNumbers = pages
      .filter((page) => page.classification === "non_certificate")
      .map((page) => page.pageNumber);

    deps.logger.info("PDF pages extracted and classified", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      totalPages: pages.length,
      certificatePages: certificatePageNumbers,
      ignoredPages: ignoredPageNumbers,
    });

    if (certificatePageNumbers.length === 0) {
      return {
        sourceContentBase64: undefined,
        pages,
        batchSummary: {
          totalPages: pages.length,
          certificatePageNumbers: [],
          ignoredPageNumbers,
          validPageNumbers: [],
          failedPageNumbers: [],
          duplicatePageNumbers: [],
        },
        validation: buildErrorValidation(
          "no_certificate_pages_detected",
          "NO_CERTIFICATE_PAGES_DETECTED",
          "No BIR 2307 certificate pages were detected in the uploaded PDF",
        ),
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: ["no_certificate_pages_detected"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    const multipleCertificateValidation =
      certificatePageNumbers.length > 1
        ? buildErrorValidation(
            "multiple_certificate_pages_detected",
            "MULTIPLE_CERTIFICATE_PAGES_DETECTED",
            `Multiple BIR 2307 certificate pages were detected: ${certificatePageNumbers
              .map((pageNumber) => `page ${pageNumber}`)
              .join(", ")}`,
          )
        : undefined;

    const primaryPage =
      pages.find((page) => page.classification === "certificate") ?? pages[0];
    const reasonCodes = multipleCertificateValidation
      ? ["multiple_certificate_pages_detected"]
      : (state.decision?.reasonCodes ?? []);
    const artifactKeys = buildArtifactKeys(state);

    return {
      sourceContentBase64: undefined,
      pages,
      extraction: primaryPage?.extraction,
      extracted: primaryPage?.extracted,
      normalized: primaryPage?.normalized,
      batchSummary: {
        totalPages: pages.length,
        certificatePageNumbers,
        ignoredPageNumbers,
        validPageNumbers: [],
        failedPageNumbers: multipleCertificateValidation
          ? certificatePageNumbers
          : [],
        duplicatePageNumbers: [],
      },
      validation: multipleCertificateValidation,
      decision: {
        terminalStatus: multipleCertificateValidation ? "Error" : "Done",
        route: multipleCertificateValidation ? "error" : "continue",
        reasonCodes,
        phase: multipleCertificateValidation ? "extract" : "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        startedAt: state.decision?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      artifactKeys,
    };
  };
}
