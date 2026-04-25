import type {
  ValidationCheck,
  ValidationResult,
  WorkflowState,
} from "../types";
import { findDuplicateCertificatePages } from "../utils/pageProcessing";

const DUPLICATE_PAGE_REASON = "duplicate_page_detected";

function buildDuplicateValidation(
  state: WorkflowState,
  duplicateDescriptions: string[],
): ValidationResult {
  const existingChecks = state.validation?.checks ?? [];
  const existingReasons = state.validation?.reasons ?? [];
  const checks: ValidationCheck[] = [
    ...existingChecks,
    {
      code: "DUPLICATE_PAGE_DETECTED",
      passed: false,
      message: `Duplicate pages detected: ${duplicateDescriptions.join(", ")}`,
    },
  ];

  return {
    status: "invalid",
    reasons: [...new Set([...existingReasons, DUPLICATE_PAGE_REASON])],
    checks,
    atcCode: state.validation?.atcCode,
    atcRate: state.validation?.atcRate,
    computedTaxBase: state.validation?.computedTaxBase,
    reportedTaxBase: state.validation?.reportedTaxBase,
    variance: state.validation?.variance,
    threshold: state.validation?.threshold,
  };
}

export function createCheckDuplicatePageNode() {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const duplicates = findDuplicateCertificatePages(state.pages ?? []);
    if (duplicates.length === 0) {
      return {
        batchSummary: {
          totalPages:
            state.batchSummary?.totalPages ?? state.pages?.length ?? 0,
          certificatePageNumbers:
            state.batchSummary?.certificatePageNumbers ?? [],
          ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
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
        },
      };
    }

    const duplicatePageNumbers = duplicates.flatMap((match) => [
      match.pageNumber,
      match.duplicateOfPageNumber,
    ]);
    const validation = buildDuplicateValidation(
      state,
      duplicates.map(
        ({ pageNumber, duplicateOfPageNumber }) =>
          `page ${pageNumber} duplicates page ${duplicateOfPageNumber}`,
      ),
    );

    return {
      validation,
      batchSummary: {
        totalPages: state.batchSummary?.totalPages ?? state.pages?.length ?? 0,
        certificatePageNumbers:
          state.batchSummary?.certificatePageNumbers ?? [],
        ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
        validPageNumbers: [],
        failedPageNumbers: [],
        duplicatePageNumbers: Array.from(new Set(duplicatePageNumbers)).sort(
          (a, b) => a - b,
        ),
      },
      decision: {
        terminalStatus: "Duplicate",
        route: "duplicate",
        reasonCodes: [
          ...new Set([
            ...(state.decision?.reasonCodes ?? []),
            DUPLICATE_PAGE_REASON,
          ]),
        ],
        phase: "extract",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
    };
  };
}
