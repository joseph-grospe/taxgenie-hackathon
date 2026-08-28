import type { Logger } from "@taxgenie/shared";
import type { DocumentExtractionClient } from "../services/documentExtractionClient";
import {
  validateDocumentExtractionPages,
  type DocumentExtractionResultV3,
} from "../services/extractionContract";
import { GeminiExtractionError } from "../services/geminiClient";
import type {
  CertificateSelectionAudit,
  PageWarning,
  SignatureFallbackAudit,
  WorkflowCertificateState,
  WorkflowState,
} from "../types";
import { MULTIPLE_CERTIFICATES_REASON_CODE } from "../types";
import {
  canonicalizeExtractedCertificate,
  getSourcePeriodValidationReasons,
} from "../utils/agenticExtraction";
import {
  selectPdfPages,
  splitPdfPages,
  type SplitPdfPage,
} from "../utils/pageProcessing";
import type { PdfBlankPageDetector } from "../utils/pdfBlankPageDetector";
import { verifyPayorSigner } from "../utils/payorSignerVerification";
import type { PdfRegionRenderer } from "../utils/pdfRegionRenderer";
import type { PdfTextLayerExtractor } from "../utils/pdfTextLayerExtractor";
import type {
  SignatureVisualDetectionResult,
  SignatureVisualDetector,
} from "../utils/signatureVisualDetector";

interface ExtractDocumentDeps {
  extractionClient: DocumentExtractionClient;
  signatureVisualDetector?: SignatureVisualDetector;
  signatureVisualMinConfidence: number;
  pdfTextLayerExtractor?: PdfTextLayerExtractor;
  pdfRegionRenderer?: PdfRegionRenderer;
  pdfBlankPageDetector?: PdfBlankPageDetector;
  payorSignerVerificationEnabled?: boolean;
  logger: Logger;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function selectFirstCertificate(
  certificates: WorkflowCertificateState["extracted"][],
): {
  responseIndex: number;
  lowestPageNumber: number;
} {
  return certificates.reduce(
    (selected, certificate, responseIndex) => {
      const lowestPageNumber = Math.min(...certificate.pageNumbers);
      if (
        lowestPageNumber < selected.lowestPageNumber ||
        (lowestPageNumber === selected.lowestPageNumber &&
          responseIndex < selected.responseIndex)
      ) {
        return { responseIndex, lowestPageNumber };
      }
      return selected;
    },
    {
      responseIndex: 0,
      lowestPageNumber: Math.min(...certificates[0]!.pageNumbers),
    },
  );
}

function safeFailureTelemetry(error: unknown): Record<string, unknown> {
  if (error instanceof GeminiExtractionError) {
    return {
      provider: "gemini",
      failureCode: error.telemetry.failureCode,
      attemptCount: error.telemetry.attemptCount,
      latencyMs: error.telemetry.latencyMs,
      status: error.telemetry.status,
      timeout: error.telemetry.timeout,
      retryable: error.telemetry.retryable,
      responseModel: error.telemetry.responseModel,
      schemaIssues: error.telemetry.schemaIssues,
      ...error.telemetry.usage,
      errorCode: error.telemetry.failureCode,
    };
  }
  return {
    provider: "gemini",
    attemptCount: 0,
    failureCode: "gemini_extraction_failed",
    errorCode: "gemini_extraction_failed",
  };
}

async function classifyUnassignedPages(input: {
  extractionResult: DocumentExtractionResultV3;
  splitPages: SplitPdfPage[];
  detector: PdfBlankPageDetector | undefined;
  sourceFileId: string;
  revision: string;
  logger: Logger;
}): Promise<{
  ignoredBlankPageNumbers: number[];
  pageWarnings: PageWarning[];
}> {
  const physicalPageCount = input.splitPages.length;
  const reportedPageCount = input.extractionResult.classification.pageCount;
  const referencedPageNumbers = new Set(
    input.extractionResult.certificates.flatMap(
      (certificate) => certificate.pageNumbers,
    ),
  );
  const candidates = input.splitPages.filter(
    (page) => !referencedPageNumbers.has(page.pageNumber),
  );
  const ignoredBlankPageNumbers: number[] = [];
  const pageWarnings: PageWarning[] = [];
  for (const page of candidates) {
    if (!input.detector) {
      pageWarnings.push({
        code: "unassigned_page_detection_failed",
        pageNumber: page.pageNumber,
      });
      continue;
    }
    try {
      const detection = await input.detector.detect({
        content: page.content,
        sourceFileId: input.sourceFileId,
        revision: input.revision,
        pageNumber: page.pageNumber,
      });
      if (detection.blank) {
        ignoredBlankPageNumbers.push(page.pageNumber);
      } else {
        pageWarnings.push({
          code: "unassigned_nonblank_page",
          pageNumber: page.pageNumber,
        });
      }
    } catch (error) {
      input.logger.warn("pdf_blank_page_detection_failed", {
        sourceFileId: input.sourceFileId,
        revision: input.revision,
        pageNumber: page.pageNumber,
        physicalPageCount,
        reportedPageCount,
        error: error instanceof Error ? error.message : String(error),
      });
      pageWarnings.push({
        code: "unassigned_page_detection_failed",
        pageNumber: page.pageNumber,
      });
    }
  }

  if (ignoredBlankPageNumbers.length > 0) {
    input.logger.info("pdf_blank_page_count_exemption_applied", {
      sourceFileId: input.sourceFileId,
      revision: input.revision,
      physicalPageCount,
      reportedPageCount,
      ignoredBlankPageNumbers,
    });
  }
  return { ignoredBlankPageNumbers, pageWarnings };
}

async function runSignatureDetector(input: {
  certificate: WorkflowCertificateState["effective"];
  pagesByNumber: Map<number, SplitPdfPage>;
  detector: SignatureVisualDetector | undefined;
  sourceFileId: string;
  revision: string;
  logger: Logger;
}): Promise<
  | { detection: SignatureVisualDetectionResult; pageNumber: number }
  | { errorCode: string }
  | undefined
> {
  if (!input.detector) {
    return undefined;
  }
  const preferred = input.certificate.signer.signature.pageNumber;
  const candidates = unique([
    ...(preferred === null ? [] : [preferred]),
    ...[...input.certificate.pageNumbers].reverse(),
  ]);
  let best:
    | { detection: SignatureVisualDetectionResult; pageNumber: number }
    | undefined;
  let failed = false;

  for (const pageNumber of candidates) {
    const page = input.pagesByNumber.get(pageNumber);
    if (!page) {
      continue;
    }
    try {
      const detection = await input.detector.detect({
        content: page.content,
        sourceFileId: input.sourceFileId,
        revision: `${input.revision}-certificate-page-${pageNumber}`,
        pageNumber,
      });
      const detectionScore =
        (detection.structure?.payorSignerWindow ? 2 : 0) +
        (detection.signaturePresent ? 1 : 0) +
        detection.confidence;
      const bestScore = best
        ? (best.detection.structure?.payorSignerWindow ? 2 : 0) +
          (best.detection.signaturePresent ? 1 : 0) +
          best.detection.confidence
        : Number.NEGATIVE_INFINITY;
      if (!best || detectionScore > bestScore) {
        best = { detection, pageNumber };
      }
      if (
        detection.status === "detected" &&
        detection.signaturePresent &&
        detection.structure?.payorSignerBandVisible === true
      ) {
        break;
      }
    } catch {
      failed = true;
      input.logger.warn("signature_visual_detection_failed", {
        sourceFileId: input.sourceFileId,
        revision: input.revision,
        pageNumber,
      });
    }
  }
  return (
    best ?? (failed ? { errorCode: "signature_visual_failed" } : undefined)
  );
}

async function applySignerFallback(input: {
  certificate: WorkflowCertificateState["effective"];
  pagesByNumber: Map<number, SplitPdfPage>;
  detector: SignatureVisualDetector | undefined;
  minimumConfidence: number;
  textLayerExtractor: PdfTextLayerExtractor | undefined;
  regionRenderer: PdfRegionRenderer | undefined;
  payorSignerVerificationEnabled: boolean;
  extractionClient: DocumentExtractionClient;
  sourceFileId: string;
  revision: string;
  logger: Logger;
}): Promise<{
  effective: WorkflowCertificateState["effective"];
  audit: SignatureFallbackAudit;
}> {
  const providerSignaturePresent =
    input.certificate.signer.signature.present === true;
  const baseAudit: SignatureFallbackAudit = {
    status: "not_run",
    promoted: false,
    minimumConfidence: input.minimumConfidence,
    providerSignaturePresent,
    textLayerRecovery: {
      status: "not_run",
      recoveredFields: [],
    },
    payorSignerVerification: {
      status: "not_run",
      recoveredFields: [],
    },
  };
  const visual = await runSignatureDetector({
    certificate: input.certificate,
    pagesByNumber: input.pagesByNumber,
    detector: input.detector,
    sourceFileId: input.sourceFileId,
    revision: input.revision,
    logger: input.logger,
  });

  let effective = input.certificate;
  let audit = baseAudit;
  let detection: SignatureVisualDetectionResult | undefined;
  let pageNumber: number | undefined;
  if (!visual) {
    audit = baseAudit;
  } else if ("errorCode" in visual) {
    audit = {
      ...audit,
      status: "failed",
      errorCode: visual.errorCode,
    };
  } else if (visual) {
    detection = visual.detection;
    pageNumber = visual.pageNumber;
    const visuallyVerified =
      detection.status === "detected" &&
      detection.signaturePresent === true &&
      detection.confidence >= input.minimumConfidence &&
      detection.structure?.payorSignerBandVisible === true;
    const promoted = visuallyVerified && !providerSignaturePresent;
    if (promoted) {
      effective = {
        ...effective,
        signer: {
          ...effective.signer,
          signature: {
            present: true,
            confidence: detection.confidence,
            pageNumber: visual.pageNumber,
            source: "visual_fallback",
          },
        },
      };
    }
    audit = {
      ...audit,
      status: detection.status,
      promoted,
      pageNumber: visual.pageNumber,
      detection,
      disagreement:
        providerSignaturePresent !== detection.signaturePresent || undefined,
    };
  }

  if (!input.payorSignerVerificationEnabled) {
    return { effective, audit };
  }

  const page =
    pageNumber === undefined ? undefined : input.pagesByNumber.get(pageNumber);
  const verification = await verifyPayorSigner({
    certificate: effective,
    pageContent: page?.content,
    pageNumber,
    detection,
    textLayerExtractor: input.textLayerExtractor,
    regionRenderer: input.regionRenderer,
    extractionClient: input.extractionClient,
    sourceFileId: input.sourceFileId,
    revision: input.revision,
    logger: input.logger,
  });
  const providerRefutingDetection =
    providerSignaturePresent &&
    detection?.signaturePresent === false &&
    verification.audit.status === "missing"
      ? detection
      : undefined;
  const verifiedEffective = providerRefutingDetection
    ? {
        ...verification.effective,
        signer: {
          ...verification.effective.signer,
          signature: {
            present: false,
            confidence: providerRefutingDetection.confidence,
            pageNumber: pageNumber ?? null,
            source: "visual_fallback" as const,
          },
        },
      }
    : verification.effective;
  return {
    effective: verifiedEffective,
    audit: {
      ...audit,
      textLayerRecovery: verification.textLayerRecovery,
      payorSignerVerification: verification.audit,
    },
  };
}

export function createExtractDocumentNode(deps: ExtractDocumentDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    if (!state.sourceContentBase64 || !state.source?.hash) {
      return {
        documentStatus: "error",
        reasonCodes: ["missing_source_content"],
        decision: {
          terminalStatus: "Error",
          route: "error",
          documentStatus: "error",
          reasonCodes: ["missing_source_content"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    const source = Buffer.from(state.sourceContentBase64, "base64");
    let splitPages: SplitPdfPage[];
    try {
      splitPages = await splitPdfPages(source);
    } catch {
      return {
        pageCount: 0,
        documentStatus: "error",
        reasonCodes: ["invalid_pdf"],
        decision: {
          terminalStatus: "Error",
          route: "error",
          documentStatus: "error",
          reasonCodes: ["invalid_pdf"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    let response;
    try {
      response = await deps.extractionClient.extract({
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        mimeType: "application/pdf",
        content: source,
      });
    } catch (error) {
      const telemetry = safeFailureTelemetry(error);
      return {
        sourceContentBase64: undefined,
        pageCount: splitPages.length,
        extractionFailureTelemetry: telemetry,
        documentStatus: "error",
        reasonCodes: [String(telemetry.errorCode)],
        decision: {
          terminalStatus: "Error",
          route: "error",
          documentStatus: "error",
          reasonCodes: [String(telemetry.errorCode)],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    const { ignoredBlankPageNumbers, pageWarnings } =
      await classifyUnassignedPages({
        extractionResult: response.result,
        splitPages,
        detector: deps.pdfBlankPageDetector,
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        logger: deps.logger,
      });
    const pageIssues = validateDocumentExtractionPages(
      response.result,
      splitPages.length,
      { ignoredBlankPageNumbers },
    );
    const multipleCertificatesDetected =
      response.result.certificates.length > 1;
    let certificateSelection: CertificateSelectionAudit | undefined;
    let selectedEntries = [...response.result.certificates.entries()];
    let extractionResult = response.result;
    let persistedPageIssues = pageIssues;
    if (multipleCertificatesDetected) {
      const selected = selectFirstCertificate(response.result.certificates);
      const selectedResponseOrdinal = selected.responseIndex + 1;
      const selectedCertificate =
        response.result.certificates[selected.responseIndex]!;
      selectedEntries = [[selected.responseIndex, selectedCertificate]];
      extractionResult = {
        ...response.result,
        certificates: [selectedCertificate],
      };
      persistedPageIssues = pageIssues
        .filter(
          (issue) =>
            issue.certificateOrdinal === undefined ||
            issue.certificateOrdinal === selectedResponseOrdinal,
        )
        .map((issue) =>
          issue.certificateOrdinal === undefined
            ? issue
            : { ...issue, certificateOrdinal: 1 },
        );
      certificateSelection = {
        strategy: "lowest_page_then_response_order",
        detectedCount: response.result.certificates.length,
        selectedResponseOrdinal,
        selectedLowestPageNumber: selected.lowestPageNumber,
        discardedCertificates: response.result.certificates.flatMap(
          (certificate, responseIndex) =>
            responseIndex === selected.responseIndex
              ? []
              : [
                  {
                    responseOrdinal: responseIndex + 1,
                    pageNumbers: [...certificate.pageNumbers],
                  },
                ],
        ),
      };
    }
    const pagesByNumber = new Map(
      splitPages.map((page) => [page.pageNumber, page]),
    );
    const certificates: WorkflowCertificateState[] = [];
    for (const [responseIndex, rawCertificate] of selectedEntries) {
      const responseOrdinal = responseIndex + 1;
      const ordinal = multipleCertificatesDetected ? 1 : responseOrdinal;
      const extracted = canonicalizeExtractedCertificate(rawCertificate);
      const fallback = await applySignerFallback({
        certificate: extracted,
        pagesByNumber,
        detector: deps.signatureVisualDetector,
        minimumConfidence: deps.signatureVisualMinConfidence,
        textLayerExtractor: deps.pdfTextLayerExtractor,
        regionRenderer: deps.pdfRegionRenderer,
        payorSignerVerificationEnabled:
          deps.payorSignerVerificationEnabled ?? true,
        extractionClient: deps.extractionClient,
        sourceFileId: state.event.sourceFileId,
        revision: `${state.event.revision}-certificate-${responseOrdinal}`,
        logger: deps.logger,
      });
      const reasons = pageIssues
        .filter(
          (issue) =>
            issue.certificateOrdinal === undefined ||
            issue.certificateOrdinal === responseOrdinal,
        )
        .map((issue) => issue.code);
      reasons.push(...getSourcePeriodValidationReasons(rawCertificate));
      if (multipleCertificatesDetected) {
        reasons.push(MULTIPLE_CERTIFICATES_REASON_CODE);
      }
      if (
        extracted.signer.signature.present === false &&
        fallback.audit.detection?.signaturePresent === true &&
        fallback.audit.detection.confidence < deps.signatureVisualMinConfidence
      ) {
        reasons.push("signature_confidence_below_threshold");
      }
      if (
        fallback.audit.status === "failed" &&
        extracted.signer.signature.present === false
      ) {
        reasons.push("signature_visual_detection_failed");
      }
      if (fallback.audit.payorSignerVerification?.status === "unverifiable") {
        reasons.push("payor_signer_block_unverifiable");
      }
      if (fallback.audit.payorSignerVerification?.status === "failed") {
        reasons.push("payor_signer_verification_failed");
      }
      let certificatePdf: Buffer | undefined;
      if (!multipleCertificatesDetected) {
        certificatePdf = await selectPdfPages(
          source,
          extracted.pageNumbers.filter(
            (pageNumber) => pageNumber >= 1 && pageNumber <= splitPages.length,
          ),
        ).catch(() => undefined);
        if (!certificatePdf) {
          reasons.push("certificate_pdf_reconstruction_failed");
        }
      }
      certificates.push({
        ordinal,
        extracted,
        effective: fallback.effective,
        status: reasons.length > 0 ? "error" : "accepted",
        reasonCodes: unique(reasons),
        signatureFallback: fallback.audit,
        certificatePdfBase64: certificatePdf?.toString("base64"),
      });
    }

    const globalReasons = pageIssues
      .filter((issue) => issue.certificateOrdinal === undefined)
      .map((issue) => issue.code);
    const noCertificates = certificates.length === 0;
    const unsupportedDocument =
      noCertificates &&
      response.result.classification.documentType === "NON_BIR_2307";
    const hasValidationError =
      multipleCertificatesDetected ||
      response.result.classification.documentType === "UNKNOWN" ||
      certificates.some((certificate) => certificate.status === "error") ||
      (noCertificates && !unsupportedDocument);
    const documentStatus = unsupportedDocument
      ? "error"
      : hasValidationError
        ? "error"
        : "accepted";
    const reasonCodes = unique([
      ...globalReasons,
      ...(unsupportedDocument ? ["non_bir_2307"] : []),
      ...(noCertificates && !unsupportedDocument
        ? ["no_certificates_extracted"]
        : []),
      ...(multipleCertificatesDetected
        ? [MULTIPLE_CERTIFICATES_REASON_CODE]
        : []),
      ...certificates.flatMap((certificate) => certificate.reasonCodes),
    ]);

    return {
      sourceContentBase64: undefined,
      extractionResult,
      extractionMetadata: response.metadata,
      extractionPageIssues: persistedPageIssues,
      ignoredBlankPageNumbers,
      pageWarnings,
      certificateSelection,
      pageCount: splitPages.length,
      certificates,
      documentStatus,
      reasonCodes,
      decision: {
        terminalStatus: documentStatus === "error" ? "Error" : "Done",
        route: "continue",
        documentStatus,
        reasonCodes,
        phase: "extract",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
    };
  };
}
