import type { Logger } from "@taxtrack/shared";
import type { ValidationResult, WorkflowPageState, WorkflowState } from "../types";
import type { MistralExtractionClient } from "../services/mistralClient";
import { classifyPageText, getExtractionText, splitPdfPages } from "../utils/pageProcessing";

interface ExtractDocumentDeps {
  ocrClient: MistralExtractionClient;
  logger: Logger;
}

function buildErrorValidation(reason: string, code: string, message: string): ValidationResult {
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

export function createExtractDocumentNode(deps: ExtractDocumentDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    if (!state.source) {
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "missing_source_metadata"],
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
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "non_pdf_input"],
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
      deps.logger.error("OCR extraction cannot proceed with empty source body", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      });
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "source_body_empty"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: buildErrorValidation("source_body_empty", "SOURCE_BODY_EMPTY", "Source body is empty"),
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
        validation: buildErrorValidation("no_pdf_pages", "NO_PDF_PAGES", "No pages were found in the uploaded PDF"),
      };
    }

    const pages: WorkflowPageState[] = [];
    for (const page of splitPages) {
      const extraction = await deps.ocrClient.extract({
        sourceFileId: state.event.sourceFileId,
        revision: `${state.event.revision}-page-${page.pageNumber}`,
        mimeType: "application/pdf",
        content: page.content,
      });

      pages.push({
        pageNumber: page.pageNumber,
        classification: classifyPageText(getExtractionText(extraction)),
        sourceContentBase64: page.content.toString("base64"),
        extraction,
        extracted: extraction.raw,
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

    if (certificatePageNumbers.length > 1) {
      return {
        sourceContentBase64: undefined,
        pages,
        batchSummary: {
          totalPages: pages.length,
          certificatePageNumbers,
          ignoredPageNumbers,
          validPageNumbers: [],
          failedPageNumbers: certificatePageNumbers,
          duplicatePageNumbers: [],
        },
        validation: buildErrorValidation(
          "multiple_certificate_pages_detected",
          "MULTIPLE_CERTIFICATE_PAGES_DETECTED",
          `Multiple BIR 2307 certificate pages were detected: ${certificatePageNumbers
            .map((pageNumber) => `page ${pageNumber}`)
            .join(", ")}`,
        ),
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: ["multiple_certificate_pages_detected"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    const primaryPage = pages.find((page) => page.classification === "certificate") ?? pages[0];

    return {
      sourceContentBase64: undefined,
      pages,
      extraction: primaryPage?.extraction,
      extracted: primaryPage?.extracted,
      batchSummary: {
        totalPages: pages.length,
        certificatePageNumbers,
        ignoredPageNumbers,
        validPageNumbers: [],
        failedPageNumbers: [],
        duplicatePageNumbers: [],
      },
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "normalize",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        startedAt: state.decision?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      artifactKeys: {
        ...state.artifactKeys,
        rawResultJson:
          state.artifactKeys?.rawResultJson ??
          `results/${state.event.sourceFileId}/${state.event.revision}/raw-extraction.json`,
      },
    };
  };
}
