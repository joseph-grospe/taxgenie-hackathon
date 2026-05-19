import type {
  ValidationCheck,
  ValidationResult,
  WorkflowPageState,
  WorkflowState,
} from "../types";
import { normalizeIdentityName } from "../utils/identityMatching";

function normalizeTinValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).replace(/\D/gu, "");
  return normalized.length > 0 ? normalized : null;
}

function getTinPrefix9(value: unknown): string | null {
  const normalized = normalizeTinValue(value);
  return normalized && normalized.length >= 9 ? normalized.slice(0, 9) : null;
}

function clonePage(page: WorkflowPageState): WorkflowPageState {
  return {
    ...page,
    extracted: page.extracted ? { ...page.extracted } : undefined,
    normalized: page.normalized ? { ...page.normalized } : undefined,
    validation: page.validation
      ? {
          ...page.validation,
          reasons: [...page.validation.reasons],
          checks: [...page.validation.checks],
        }
      : undefined,
    masterlistLookup: page.masterlistLookup
      ? {
          ...page.masterlistLookup,
          matches: [...page.masterlistLookup.matches],
        }
      : undefined,
  };
}

function buildInvalidValidation(
  reasonCode: string,
  check: ValidationCheck,
): ValidationResult {
  return {
    status: "invalid",
    reasons: [reasonCode],
    checks: [check],
  };
}

export function createValidateEntityTinNode() {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const pages = (state.pages ?? []).map(clonePage);
    const page = pages.find((item) => item.classification === "certificate");
    const pageIndex = page
      ? pages.findIndex((item) => item.pageNumber === page.pageNumber)
      : -1;

    const fail = (
      reasonCode: string,
      check: ValidationCheck,
    ): Partial<WorkflowState> => {
      const validation = buildInvalidValidation(reasonCode, check);
      const nextPages = [...pages];

      if (page && pageIndex >= 0) {
        nextPages.splice(pageIndex, 1, {
          ...page,
          validation,
          decision: {
            terminalStatus: "Error",
            route: "error",
            reasonCodes: [reasonCode],
            phase: "validate",
          },
        });
      }

      return {
        pages: nextPages,
        validation,
        batchSummary: {
          totalPages: state.batchSummary?.totalPages ?? nextPages.length,
          certificatePageNumbers:
            state.batchSummary?.certificatePageNumbers ?? [],
          ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
          validPageNumbers: [],
          failedPageNumbers: page ? [page.pageNumber] : [],
          duplicatePageNumbers: state.batchSummary?.duplicatePageNumbers ?? [],
        },
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [reasonCode],
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          startedAt: state.decision?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    };

    if (!page) {
      return fail("missing_certificate_payload", {
        code: "MISSING_CERTIFICATE_PAYLOAD",
        passed: false,
        message: "No certificate available for entity TIN validation",
      });
    }

    const selectedEntity = state.event.selectedEntity;
    if (!selectedEntity) {
      return fail("missing_selected_entity", {
        code: "SELECTED_ENTITY_REQUIRED",
        passed: false,
        message: "Selected upload entity is missing",
      });
    }

    const selectedEntityTinPrefix = getTinPrefix9(selectedEntity.tin);
    const selectedEntityCompanyName = normalizeIdentityName(
      selectedEntity.companyName,
    );
    if (!selectedEntityTinPrefix && !selectedEntityCompanyName) {
      return fail("invalid_selected_entity_tin", {
        code: "SELECTED_ENTITY_TIN_INVALID",
        passed: false,
        message:
          "Selected entity must contain at least 9 TIN digits or a company name",
      });
    }

    const payeeTinPrefix = getTinPrefix9(page.normalized?.payeeTin);
    const payeeName = normalizeIdentityName(page.normalized?.payeeName);

    if (
      selectedEntityTinPrefix &&
      payeeTinPrefix &&
      selectedEntityTinPrefix === payeeTinPrefix
    ) {
      return {
        pages,
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: state.decision?.reasonCodes ?? [],
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          startedAt: state.decision?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    }

    if (payeeName && selectedEntityCompanyName === payeeName) {
      return {
        pages,
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: state.decision?.reasonCodes ?? [],
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          startedAt: state.decision?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    }

    if (!payeeTinPrefix && !payeeName) {
      return fail("missing_payee_tin_for_entity_match", {
        code: "PAYEE_TIN_REQUIRED_FOR_ENTITY_MATCH",
        passed: false,
        message:
          "Payee TIN must contain at least 9 digits or payee name must match the selected entity company name",
      });
    }

    return fail("entity_payee_tin_mismatch", {
      code: "ENTITY_PAYEE_TIN_MATCH",
      passed: false,
      message:
        "Selected entity TIN/company name does not match payee TIN/name",
    });
  };
}
