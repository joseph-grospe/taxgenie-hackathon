import type { Logger } from "@taxtrack/shared";
import type {
  NormalizedFields,
  ValidationCheck,
  ValidationResult,
  WorkflowPageState,
  WorkflowState,
} from "../types";
import { parseBooleanish, parseMoney, roundMoney } from "../utils/parsing";

interface ValidateDeps {
  atcRates: Record<string, number>;
  varianceThresholdPhp: number;
  logger: Logger;
}

function pushCheck(
  checks: ValidationCheck[],
  check: ValidationCheck,
): ValidationCheck[] {
  checks.push(check);
  return checks;
}

function parseRequiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeAtcCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "");

  return normalized.length > 0 ? normalized : undefined;
}

function hasPrintedName(raw: unknown): boolean {
  const parsed = parseBooleanish(raw);
  if (typeof parsed === "boolean") {
    return parsed;
  }

  return typeof raw === "string" && raw.trim().length > 0;
}

function validatePresence(
  fields: NormalizedFields,
  code: string,
  label: string,
  checks: ValidationCheck[],
  reasons: string[],
) {
  const value = parseRequiredString(
    (fields as Record<string, unknown>)[code] as string | undefined,
  );
  if (!value) {
    reasons.push(`missing_${code}`);
    pushCheck(checks, {
      code: `${code.toUpperCase()}_REQUIRED`,
      passed: false,
      message: `${label} is missing`,
    });
    return false;
  }

  pushCheck(checks, {
    code: `${code.toUpperCase()}_REQUIRED`,
    passed: true,
    message: `${label} present`,
  });
  return true;
}

function validatePage(
  normalized: NormalizedFields,
  deps: ValidateDeps,
): ValidationResult {
  const checks: ValidationCheck[] = [];
  const reasons: string[] = [];

  const atcCode = normalizeAtcCode(normalized.atcCode);
  const taxWithheld = parseMoney(normalized.taxWithheld);
  const reportedTaxBase = parseMoney(normalized.taxBase);
  const hasPrintedNameValue = hasPrintedName(normalized.printedName);
  const signature = parseBooleanish(
    normalized.signaturePresent ?? normalized.signature,
  );

  validatePresence(normalized, "payeeName", "Payee name", checks, reasons);
  validatePresence(normalized, "payorName", "Payor name", checks, reasons);
  validatePresence(normalized, "payeeTin", "Payee TIN", checks, reasons);
  validatePresence(normalized, "payorTin", "Payor TIN", checks, reasons);
  validatePresence(normalized, "atcCode", "ATC code", checks, reasons);
  validatePresence(
    normalized,
    "periodCovered",
    "Period covered",
    checks,
    reasons,
  );

  if (!atcCode || !(deps.atcRates[atcCode] && deps.atcRates[atcCode] > 0)) {
    reasons.push("unknown_atc_code");
    pushCheck(checks, {
      code: "ATC_RATE_NOT_FOUND",
      passed: false,
      message: `ATC rate not configured: ${atcCode ?? "undefined"}`,
    });
  } else {
    pushCheck(checks, {
      code: "ATC_RATE_FOUND",
      passed: true,
      message: `ATC rate resolved: ${atcCode}`,
    });
  }

  if (!hasPrintedNameValue) {
    reasons.push("missing_printed_name");
    pushCheck(checks, {
      code: "PRINTED_NAME_MISSING",
      passed: false,
      message: "Printed name not present",
    });
  } else {
    pushCheck(checks, {
      code: "PRINTED_NAME_PRESENT",
      passed: true,
      message: "Printed name present",
    });
  }

  if (typeof signature !== "boolean" || !signature) {
    reasons.push("missing_signature");
    pushCheck(checks, {
      code: "SIGNATURE_MISSING",
      passed: false,
      message: "Signature not present",
    });
  } else {
    pushCheck(checks, {
      code: "SIGNATURE_PRESENT",
      passed: true,
      message: "Signature present",
    });
  }

  if (
    reportedTaxBase === undefined ||
    !Number.isFinite(reportedTaxBase) ||
    reportedTaxBase <= 0
  ) {
    reasons.push("invalid_tax_base");
    pushCheck(checks, {
      code: "TAX_BASE_INVALID",
      passed: false,
      message: "Tax base invalid or non-positive",
    });
  } else {
    pushCheck(checks, {
      code: "TAX_BASE_VALID",
      passed: true,
      message: "Tax base valid",
    });
  }

  if (
    taxWithheld === undefined ||
    !Number.isFinite(taxWithheld) ||
    taxWithheld <= 0
  ) {
    reasons.push("invalid_tax_withheld");
    pushCheck(checks, {
      code: "TAX_WITHHELD_INVALID",
      passed: false,
      message: "Tax withheld invalid or non-positive",
    });
  } else {
    pushCheck(checks, {
      code: "TAX_WITHHELD_VALID",
      passed: true,
      message: "Tax withheld valid",
    });
  }

  const atcRate = atcCode ? deps.atcRates[atcCode] : undefined;
  let computedTaxBase: number | undefined;
  let variance: number | undefined;
  if (
    atcRate &&
    taxWithheld !== undefined &&
    Number.isFinite(taxWithheld) &&
    taxWithheld > 0 &&
    reportedTaxBase !== undefined
  ) {
    computedTaxBase = roundMoney(taxWithheld / atcRate);
    variance = roundMoney(Math.abs(computedTaxBase - reportedTaxBase));
    if (!Number.isFinite(variance) || variance > deps.varianceThresholdPhp) {
      reasons.push("variance_exceeded");
      pushCheck(checks, {
        code: "TAX_BASE_VARIANCE",
        passed: false,
        message: `Variance ${variance} exceeds threshold ${deps.varianceThresholdPhp}`,
      });
    } else {
      pushCheck(checks, {
        code: "TAX_BASE_VARIANCE",
        passed: true,
        message: `Variance ${variance} within threshold`,
      });
    }
  }

  return {
    status: reasons.length === 0 ? "valid" : "invalid",
    reasons,
    checks,
    atcCode,
    atcRate,
    computedTaxBase,
    reportedTaxBase,
    variance,
    threshold: deps.varianceThresholdPhp,
  };
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

export function createValidateRulesNode(deps: ValidateDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const pages = (state.pages ?? []).map(clonePage);
    const certificatePages = pages.filter(
      (page) => page.classification === "certificate",
    );
    const failedPageNumbers: number[] = [];
    const allReasonCodes: string[] = [];

    for (const page of certificatePages) {
      const normalized = (page.normalized ?? {}) as NormalizedFields;
      const validation = validatePage(normalized, deps);
      const nextPage: WorkflowPageState = {
        ...page,
        validation,
      };
      if (validation.status === "invalid") {
        nextPage.decision = {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: validation.reasons,
          phase: "validate",
        };
        failedPageNumbers.push(page.pageNumber);
        allReasonCodes.push(...validation.reasons);
      }

      pages.splice(
        pages.findIndex((item) => item.pageNumber === page.pageNumber),
        1,
        nextPage,
      );
    }

    deps.logger.info("Validation completed for certificate pages", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      failedPageNumbers,
      certificatePages: certificatePages.map((page) => page.pageNumber),
    });

    const primaryPage = pages.find(
      (page) =>
        page.classification === "certificate" &&
        page.validation?.status === "valid",
    );

    if (failedPageNumbers.length > 0) {
      return {
        pages,
        validation: {
          status: "invalid",
          reasons: Array.from(new Set(allReasonCodes)),
          checks: failedPageNumbers.map((pageNumber) => ({
            code: "CERTIFICATE_PAGE_VALIDATION_FAILED",
            passed: false,
            message: `Validation failed for page ${pageNumber}`,
          })),
        },
        batchSummary: {
          totalPages: state.batchSummary?.totalPages ?? pages.length,
          certificatePageNumbers:
            state.batchSummary?.certificatePageNumbers ?? [],
          ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
          validPageNumbers: [],
          failedPageNumbers: Array.from(new Set(failedPageNumbers)).sort(
            (a, b) => a - b,
          ),
          duplicatePageNumbers: state.batchSummary?.duplicatePageNumbers ?? [],
        },
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: Array.from(new Set(allReasonCodes)),
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        artifactKeys: state.artifactKeys,
      };
    }

    return {
      pages,
      validation: primaryPage?.validation,
      batchSummary: {
        totalPages: state.batchSummary?.totalPages ?? pages.length,
        certificatePageNumbers:
          state.batchSummary?.certificatePageNumbers ?? [],
        ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
        validPageNumbers: certificatePages
          .map((page) => page.pageNumber)
          .sort((a, b) => a - b),
        failedPageNumbers: [],
        duplicatePageNumbers: state.batchSummary?.duplicatePageNumbers ?? [],
      },
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
      artifactKeys: state.artifactKeys,
    };
  };
}
