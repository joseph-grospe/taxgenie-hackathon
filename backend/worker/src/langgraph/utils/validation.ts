import type { ValidationCheck, ValidationResult } from "../types";

const validationMetricKeys = [
  "atcCode",
  "atcRate",
  "computedTaxBase",
  "reportedTaxBase",
  "variance",
  "threshold",
] as const satisfies ReadonlyArray<keyof ValidationResult>;

export function buildInvalidValidation(
  reasonCode: string,
  check: ValidationCheck,
): ValidationResult {
  return {
    status: "invalid",
    reasons: [reasonCode],
    checks: [check],
  };
}

export function mergeValidationResults(
  ...results: Array<ValidationResult | undefined>
): ValidationResult | undefined {
  const availableResults = results.filter(
    (result): result is ValidationResult => Boolean(result),
  );

  if (availableResults.length === 0) {
    return undefined;
  }

  const reasons: string[] = [];
  const reasonSet = new Set<string>();
  const checks: ValidationCheck[] = [];
  const merged: ValidationResult = {
    status: "valid",
    reasons,
    checks,
  };

  for (const result of availableResults) {
    for (const reason of result.reasons) {
      if (!reasonSet.has(reason)) {
        reasonSet.add(reason);
        reasons.push(reason);
      }
    }

    checks.push(...result.checks);

    for (const key of validationMetricKeys) {
      const value = result[key];
      if (value !== undefined) {
        Object.assign(merged, { [key]: value });
      }
    }
  }

  merged.status =
    reasons.length > 0 || checks.some((check) => check.passed === false)
      ? "invalid"
      : "valid";

  return merged;
}
