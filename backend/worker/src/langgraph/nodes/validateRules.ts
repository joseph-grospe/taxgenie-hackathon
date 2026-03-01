import type { Logger } from "@taxtrack/shared";
import type { NormalizedFields, ValidationCheck, ValidationResult, WorkflowState } from "../types";
import { parseBooleanish, parseMoney, roundMoney } from "../utils/parsing";

interface ValidateDeps {
  atcRates: Record<string, number>;
  varianceThresholdPhp: number;
  logger: Logger;
}

function pushCheck(checks: ValidationCheck[], check: ValidationCheck): ValidationCheck[] {
  checks.push(check);
  return checks;
}

function parseRequiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

function validatePresence(fields: NormalizedFields, code: string, label: string, checks: ValidationCheck[], reasons: string[]) {
  const value = parseRequiredString((fields as Record<string, unknown>)[code] as string | undefined);
  if (!value) {
    reasons.push(`missing_${code}`);
    pushCheck(checks, {
      code: `${code.toUpperCase()}_REQUIRED`,
      passed: false,
      message: `${label} is missing`
    });
    return false;
  }

  pushCheck(checks, {
    code: `${code.toUpperCase()}_REQUIRED`,
    passed: true,
    message: `${label} present`
  });
  return true;
}

export function createValidateRulesNode(deps: ValidateDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const checks: ValidationCheck[] = [];
    const reasons: string[] = [];

    const normalized = (state.normalized ?? {}) as NormalizedFields;
    const atcCode = normalizeAtcCode(normalized.atcCode);
    const taxWithheld = parseMoney(normalized.taxWithheld);
    const reportedTaxBase = parseMoney(normalized.taxBase);
    const hasPrintedNameValue = hasPrintedName(normalized.printedName);
    const signature = parseBooleanish(normalized.signature);

    validatePresence(normalized, "payeeName", "Payee name", checks, reasons);
    validatePresence(normalized, "payorName", "Payor name", checks, reasons);
    validatePresence(normalized, "payeeTin", "Payee TIN", checks, reasons);
    validatePresence(normalized, "payorTin", "Payor TIN", checks, reasons);
    validatePresence(normalized, "atcCode", "ATC code", checks, reasons);
    validatePresence(normalized, "periodCovered", "Period covered", checks, reasons);

    if (!atcCode || !(deps.atcRates[atcCode] && deps.atcRates[atcCode] > 0)) {
      reasons.push("unknown_atc_code");
      pushCheck(checks, {
        code: "ATC_RATE_NOT_FOUND",
        passed: false,
        message: `ATC rate not configured: ${atcCode ?? "undefined"}`
      });
    } else {
      pushCheck(checks, {
        code: "ATC_RATE_FOUND",
        passed: true,
        message: `ATC rate resolved: ${atcCode}`
      });
    }

    if (!hasPrintedNameValue) {
      reasons.push("missing_printed_name");
      pushCheck(checks, {
        code: "PRINTED_NAME_MISSING",
        passed: false,
        message: "Printed name not present"
      });
    } else {
      pushCheck(checks, {
        code: "PRINTED_NAME_PRESENT",
        passed: true,
        message: "Printed name present"
      });
    }

    if (typeof signature !== "boolean" || !signature) {
      reasons.push("missing_signature");
      pushCheck(checks, {
        code: "SIGNATURE_MISSING",
        passed: false,
        message: "Signature not present"
      });
    } else {
      pushCheck(checks, {
        code: "SIGNATURE_PRESENT",
        passed: true,
        message: "Signature present"
      });
    }

    if (reportedTaxBase === undefined || !Number.isFinite(reportedTaxBase) || reportedTaxBase <= 0) {
      reasons.push("invalid_tax_base");
      pushCheck(checks, {
        code: "TAX_BASE_INVALID",
        passed: false,
        message: "Tax base invalid or non-positive"
      });
    } else {
      pushCheck(checks, {
        code: "TAX_BASE_VALID",
        passed: true,
        message: "Tax base valid"
      });
    }

    if (taxWithheld === undefined || !Number.isFinite(taxWithheld) || taxWithheld <= 0) {
      reasons.push("invalid_tax_withheld");
      pushCheck(checks, {
        code: "TAX_WITHHELD_INVALID",
        passed: false,
        message: "Tax withheld invalid or non-positive"
      });
    } else {
      pushCheck(checks, {
        code: "TAX_WITHHELD_VALID",
        passed: true,
        message: "Tax withheld valid"
      });
    }

    const atcRate = atcCode ? deps.atcRates[atcCode] : undefined;
    let computedTaxBase: number | undefined;
    let variance: number | undefined;
    if (atcRate && taxWithheld !== undefined && Number.isFinite(taxWithheld) && taxWithheld > 0 && reportedTaxBase !== undefined) {
      computedTaxBase = roundMoney(taxWithheld / atcRate);
      variance = roundMoney(Math.abs(computedTaxBase - reportedTaxBase));
      if (!Number.isFinite(variance) || variance > deps.varianceThresholdPhp) {
        reasons.push("variance_exceeded");
        pushCheck(checks, {
          code: "TAX_BASE_VARIANCE",
          passed: false,
          message: `Variance ${variance} exceeds threshold ${deps.varianceThresholdPhp}`
        });
      } else {
        pushCheck(checks, {
          code: "TAX_BASE_VARIANCE",
          passed: true,
          message: `Variance ${variance} within threshold`
        });
      }
    }

    const validation: ValidationResult = {
      status: reasons.length === 0 ? "valid" : "invalid",
      reasons,
      checks,
      atcCode,
      atcRate,
      computedTaxBase,
      reportedTaxBase,
      variance,
      threshold: deps.varianceThresholdPhp
    };

    deps.logger.info("Validation completed", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      status: validation.status,
      reasons: reasons.length
    });

    const route = validation.status === "valid" ? "continue" : "error";
    return {
      validation,
      decision: {
        terminalStatus: validation.status === "valid" ? "Done" : "Error",
        route,
        reasonCodes: reasons,
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      },
      artifactKeys: state.artifactKeys
    };
  };
}
