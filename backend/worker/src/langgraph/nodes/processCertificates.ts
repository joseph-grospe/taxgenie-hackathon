import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { Logger } from "@taxgenie/shared";
import type { AtcRuleMap } from "../../db/atcCodes";
import type { DbClient } from "../../db/client";
import {
  documentResults,
  extractedCertificates,
  masterlist,
} from "../../db/schema";
import type { DocumentExtractionClient } from "../services/documentExtractionClient";
import type {
  IdentityField,
  IdentityFieldDecisionAudit,
  IdentityParty,
  MasterlistFieldLookupResult,
  MasterlistLookupResult,
  ReconciliationTotals,
  TaxRowValidationResult,
  ValidationCheck,
  ValidationResult,
  WorkflowCertificateState,
  WorkflowState,
} from "../types";
import { MULTIPLE_CERTIFICATES_REASON_CODE } from "../types";
import { normalizeAtcCode } from "../utils/atc";
import {
  buildCertificateFingerprint,
  normalizeNullableSourceString,
} from "../utils/agenticExtraction";
import {
  compactIdentityNameSql,
  normalizeIdentityName,
} from "../utils/identityMatching";
import type { PdfRegionRenderer } from "../utils/pdfRegionRenderer";
import { resolveIdentityFieldConfidence } from "../utils/identityConfidenceVerification";

interface ProcessCertificatesDeps {
  db: DbClient;
  getAtcRules: () => Promise<AtcRuleMap>;
  varianceThresholdPhp: number;
  extractionClient?: DocumentExtractionClient;
  pdfRegionRenderer?: PdfRegionRenderer;
  identityConfidenceFlowEnabled?: boolean;
  logger: Logger;
}

function tinDigits(value: string | null | undefined): string {
  return value?.replace(/\D/gu, "") ?? "";
}

function tinPrefix(value: string | null | undefined): string {
  return tinDigits(value).slice(0, 9);
}

async function lookupMasterlistTin(
  db: DbClient,
  value: string | null | undefined,
): Promise<MasterlistFieldLookupResult> {
  const tin = tinPrefix(value);
  if (tin.length !== 9) {
    return {
      status: "skipped",
      matchCount: 0,
      matches: [],
    };
  }
  try {
    const matches = await db
      .select()
      .from(masterlist)
      .where(
        sql`regexp_replace(coalesce(${masterlist.tin}, ''), '[^0-9]', '', 'g') like ${`${tin}%`}`,
      )
      .orderBy(asc(masterlist.shortName), asc(masterlist.customerName))
      .limit(10);
    return {
      status: matches.length > 0 ? "matched" : "not_found",
      query: tin,
      matchCount: matches.length,
      matches,
    };
  } catch (error) {
    return {
      status: "error",
      query: tin,
      matchCount: 0,
      matches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function selectedEntityTinMatches(
  state: WorkflowState,
  certificate: WorkflowCertificateState,
): boolean {
  const selected = state.event.selectedEntity;
  if (!selected) {
    return false;
  }
  const selectedTin = tinPrefix(selected.tin);
  const payeeTin = tinPrefix(certificate.effective.payee.tin);
  return selectedTin.length === 9 && selectedTin === payeeTin;
}

function selectedEntityNameMatches(
  state: WorkflowState,
  certificate: WorkflowCertificateState,
): boolean {
  const selected = state.event.selectedEntity;
  if (!selected) {
    return false;
  }
  const selectedName = normalizeIdentityName(
    normalizeNullableSourceString(selected.companyName),
  );
  const payeeName = normalizeIdentityName(
    normalizeNullableSourceString(certificate.effective.payee.name),
  );
  return (
    selectedName !== null &&
    payeeName !== null &&
    selectedName.includes(payeeName)
  );
}

function selectedEntityTinFailureMessage(
  state: WorkflowState,
  certificate: WorkflowCertificateState,
): string {
  const selected = state.event.selectedEntity;
  if (!selected) {
    return "Selected upload entity is missing for payee TIN validation";
  }

  const selectedTin = tinPrefix(selected.tin);
  if (selectedTin.length !== 9) {
    return "Selected entity TIN must contain at least 9 digits";
  }

  const payeeTin = tinPrefix(certificate.effective.payee.tin);
  if (payeeTin.length !== 9) {
    return "Payee TIN must contain at least 9 digits to match the selected entity";
  }

  return `Payee TIN prefix "${payeeTin}" does not match selected entity TIN prefix "${selectedTin}"`;
}

function selectedEntityNameFailureMessage(
  state: WorkflowState,
  certificate: WorkflowCertificateState,
): string {
  const selected = state.event.selectedEntity;
  if (!selected) {
    return "Selected upload entity is missing for payee name validation";
  }

  const selectedName = normalizeIdentityName(
    normalizeNullableSourceString(selected.companyName),
  );
  if (!selectedName) {
    return "Selected entity company name is missing";
  }

  const payeeName = normalizeIdentityName(
    normalizeNullableSourceString(certificate.effective.payee.name),
  );
  if (!payeeName) {
    return "Payee name is missing before selected entity validation";
  }

  return `Payee name "${normalizeNullableSourceString(certificate.effective.payee.name) ?? ""}" does not match selected entity company name "${normalizeNullableSourceString(selected.companyName) ?? ""}"`;
}

function masterlistTinFailureMessage(
  certificate: WorkflowCertificateState,
  lookup: MasterlistFieldLookupResult,
): string {
  if (lookup.status === "error") {
    return `Masterlist payor TIN lookup failed: ${lookup.error ?? "masterlist_lookup_failed"}`;
  }
  if (lookup.status === "skipped") {
    return "Payor TIN must contain at least 9 digits for masterlist validation";
  }

  return `Payor TIN prefix "${tinPrefix(certificate.effective.payor.tin)}" was not found in the masterlist`;
}

function masterlistNameFailureMessage(
  certificate: WorkflowCertificateState,
  lookup: MasterlistFieldLookupResult,
): string {
  if (lookup.status === "error") {
    return `Masterlist payor name lookup failed: ${lookup.error ?? "masterlist_lookup_failed"}`;
  }
  if (lookup.status === "skipped") {
    return "Payor name is missing before masterlist validation";
  }

  const payorName =
    normalizeNullableSourceString(certificate.effective.payor.name) ?? "";
  return `Payor name "${payorName}" was not found in the masterlist`;
}

function addCheck(
  checks: ValidationCheck[],
  reasons: string[],
  code: string,
  passed: boolean | null,
  successMessage: string,
  failureMessage: string,
  reason: string,
): void {
  checks.push({
    code,
    passed,
    message: passed === true ? successMessage : failureMessage,
  });
  if (passed === false) {
    reasons.push(reason);
  }
}

function identityDecision(
  certificate: WorkflowCertificateState,
  party: IdentityParty,
  field: IdentityField,
): IdentityFieldDecisionAudit | undefined {
  return certificate.identityFieldDecisions?.find(
    (decision) => decision.party === party && decision.field === field,
  );
}

function identityNeedsReview(
  certificate: WorkflowCertificateState,
  party: IdentityParty,
  field: IdentityField,
): boolean {
  return (
    identityDecision(certificate, party, field)?.status === "manual_review"
  );
}

function identityIsConfirmedBlank(
  certificate: WorkflowCertificateState,
  party: IdentityParty,
  field: IdentityField,
): boolean {
  return (
    identityDecision(certificate, party, field)?.status === "confirmed_blank"
  );
}

function addIdentityCheck(input: {
  checks: ValidationCheck[];
  reasons: string[];
  certificate: WorkflowCertificateState;
  party: IdentityParty;
  field: IdentityField;
  code: string;
  passed: boolean;
  successMessage: string;
  failureMessage: string;
  reason: string;
  referenceCheck?: boolean;
}): void {
  if (identityNeedsReview(input.certificate, input.party, input.field)) {
    input.checks.push({
      code: input.code,
      passed: null,
      message: `${input.party} ${input.field} requires manual review because the visible value could not be read with sufficient confidence.`,
    });
    return;
  }
  if (
    input.referenceCheck &&
    identityIsConfirmedBlank(input.certificate, input.party, input.field)
  ) {
    input.checks.push({
      code: input.code,
      passed: null,
      message: `${input.party} ${input.field} reference validation was skipped because the field is visibly blank.`,
    });
    return;
  }
  addCheck(
    input.checks,
    input.reasons,
    input.code,
    input.passed,
    input.successMessage,
    input.failureMessage,
    input.reason,
  );
}

function identityReviewReason(decision: IdentityFieldDecisionAudit): string {
  return `ai_cannot_read_${decision.party}_${decision.field}`;
}

function identityRereadFailureReason(
  decision: IdentityFieldDecisionAudit,
): string | undefined {
  return decision.decisionReason === "reread_failed"
    ? `identity_reread_failed_${decision.party}_${decision.field}`
    : undefined;
}

function isIdentityReviewReason(reason: string): boolean {
  return (
    reason.startsWith("ai_cannot_read_") ||
    reason.startsWith("identity_reread_failed_")
  );
}

function hasSourceValue(value: string | null): boolean {
  return normalizeNullableSourceString(value) !== null;
}

function parseDecimal(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const formatMoney = (value: number): string => value.toFixed(2);

function isActiveTaxRow(
  row: WorkflowCertificateState["effective"]["taxRows"][number],
): boolean {
  return [
    row.monthlyAmounts.first,
    row.monthlyAmounts.second,
    row.monthlyAmounts.third,
    row.taxBase,
    row.taxWithheld,
  ].some((value) => value !== null);
}

function prepareCertificateTaxData(
  certificate: WorkflowCertificateState,
  atcRules: AtcRuleMap,
  varianceThresholdPhp: number,
): WorkflowCertificateState {
  const taxRows = certificate.effective.taxRows
    .filter(isActiveTaxRow)
    .map((row) => {
      const atcCode = normalizeAtcCode(row.atcCode) ?? null;
      const rule = atcCode ? atcRules[atcCode] : undefined;
      return {
        ...row,
        atcCode,
        taxRate: rule ? String(rule.rate) : row.taxRate,
      };
    })
    .sort(
      (left, right) =>
        left.pageNumber - right.pageNumber ||
        left.lineNumber - right.lineNumber,
    );
  const primaryRow =
    taxRows.find((row) => {
      const rule = row.atcCode ? atcRules[row.atcCode] : undefined;
      return rule?.taxType === "WE";
    }) ?? taxRows.find((row) => row.atcCode !== null);
  const reconciliationRows = taxRows.filter((row) => {
    const rule = row.atcCode ? atcRules[row.atcCode] : undefined;
    if (rule?.taxType !== "WE") {
      return false;
    }
    const taxBase = parseDecimal(row.taxBase);
    const taxWithheld = parseDecimal(row.taxWithheld);
    if (
      taxBase === undefined ||
      taxBase <= 0 ||
      taxWithheld === undefined ||
      taxWithheld <= 0
    ) {
      return false;
    }
    const computedTaxBase = Number((taxWithheld / rule.rate).toFixed(2));
    const variance = Number(Math.abs(computedTaxBase - taxBase).toFixed(2));
    return variance <= varianceThresholdPhp;
  });
  const reconciliationTotals: ReconciliationTotals =
    reconciliationRows.length > 0
      ? {
          taxBase: formatMoney(
            reconciliationRows.reduce(
              (total, row) => total + (parseDecimal(row.taxBase) ?? 0),
              0,
            ),
          ),
          taxWithheld: formatMoney(
            reconciliationRows.reduce(
              (total, row) => total + (parseDecimal(row.taxWithheld) ?? 0),
              0,
            ),
          ),
        }
      : { taxBase: null, taxWithheld: null };

  return {
    ...certificate,
    effective: {
      ...certificate.effective,
      taxRows,
      primaryAtcCode: primaryRow?.atcCode ?? null,
    },
    reconciliationTotals,
  };
}

function validateTaxRow(input: {
  row: WorkflowCertificateState["effective"]["taxRows"][number];
  atcRules: AtcRuleMap;
  varianceThresholdPhp: number;
}): TaxRowValidationResult {
  const { row, atcRules, varianceThresholdPhp } = input;
  const checks: ValidationCheck[] = [];
  const reasons: string[] = [];
  const atcCode = normalizeAtcCode(row.atcCode);
  const rule = atcCode ? atcRules[atcCode] : undefined;
  const taxBase = parseDecimal(row.taxBase);
  const taxWithheld = parseDecimal(row.taxWithheld);
  const label = `Tax row ${row.lineNumber}`;

  addCheck(
    checks,
    reasons,
    "ATC_CODE_PRESENT",
    Boolean(atcCode),
    `${label} ATC code is present.`,
    `${label} ATC code is missing`,
    "missing_atc_code",
  );
  if (atcCode) {
    addCheck(
      checks,
      reasons,
      "ATC_RATE_FOUND",
      Boolean(rule),
      `${label} ATC has a configured tax rule.`,
      `ATC rate not configured: ${atcCode}`,
      "unknown_atc_code",
    );
  }
  addCheck(
    checks,
    reasons,
    "TAX_BASE_PRESENT",
    taxBase !== undefined,
    `${label} tax base is present.`,
    `${label} tax base is missing`,
    "missing_tax_base",
  );
  if (taxBase !== undefined) {
    addCheck(
      checks,
      reasons,
      "TAX_BASE_VALID",
      taxBase > 0,
      `${label} tax base is positive.`,
      `${label} tax base is invalid or non-positive`,
      "invalid_tax_base",
    );
  }
  addCheck(
    checks,
    reasons,
    "TAX_WITHHELD_PRESENT",
    taxWithheld !== undefined,
    `${label} tax withheld is present.`,
    `${label} tax withheld is missing`,
    "missing_tax_withheld",
  );
  if (taxWithheld !== undefined) {
    addCheck(
      checks,
      reasons,
      "TAX_WITHHELD_VALID",
      taxWithheld > 0,
      `${label} tax withheld is positive.`,
      `${label} tax withheld is invalid or non-positive`,
      "invalid_tax_withheld",
    );
  }

  let computedTaxBase: number | undefined;
  let variance: number | undefined;
  if (
    rule &&
    taxBase !== undefined &&
    taxBase > 0 &&
    taxWithheld !== undefined &&
    taxWithheld > 0
  ) {
    computedTaxBase = Number((taxWithheld / rule.rate).toFixed(2));
    variance = Number(Math.abs(computedTaxBase - taxBase).toFixed(2));
    addCheck(
      checks,
      reasons,
      "TAX_BASE_VARIANCE",
      variance <= varianceThresholdPhp,
      `${label} tax base variance is within the configured threshold.`,
      `${label} variance ${variance} exceeds threshold ${varianceThresholdPhp}`,
      "variance_exceeded",
    );
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    lineNumber: row.lineNumber,
    pageNumber: row.pageNumber,
    atcCode: atcCode ?? undefined,
    taxType: rule?.taxType,
    atcRate: rule?.rate,
    computedTaxBase,
    reportedTaxBase: taxBase,
    variance,
    status: uniqueReasons.length === 0 ? "valid" : "invalid",
    reasons: uniqueReasons,
    checks,
  };
}

function validateCertificate(input: {
  state: WorkflowState;
  certificate: WorkflowCertificateState;
  atcRules: AtcRuleMap;
  varianceThresholdPhp: number;
  masterlistLookup: MasterlistLookupResult;
}): ValidationResult {
  const { state, certificate, atcRules, varianceThresholdPhp } = input;
  const value = certificate.effective;
  const checks: ValidationCheck[] = [];
  const reasons = [...certificate.reasonCodes];
  const atcCode = normalizeAtcCode(value.primaryAtcCode);
  const configuredRule = atcCode ? atcRules[atcCode] : undefined;
  const taxRows = value.taxRows.map((row) =>
    validateTaxRow({ row, atcRules, varianceThresholdPhp }),
  );
  checks.push(...taxRows.flatMap((row) => row.checks));
  reasons.push(...taxRows.flatMap((row) => row.reasons));
  const primaryRow =
    taxRows.find((row) => row.atcCode === atcCode) ?? taxRows[0];

  for (const identity of [
    {
      party: "payee" as const,
      field: "name" as const,
      code: "PAYEE_NAME_PRESENT",
      value: value.payee.name,
      label: "Payee name",
      reason: "missing_payee_name",
    },
    {
      party: "payor" as const,
      field: "name" as const,
      code: "PAYOR_NAME_PRESENT",
      value: value.payor.name,
      label: "Payor name",
      reason: "missing_payor_name",
    },
    {
      party: "payee" as const,
      field: "tin" as const,
      code: "PAYEE_TIN_PRESENT",
      value: value.payee.tin,
      label: "Payee TIN",
      reason: "missing_payee_tin",
    },
    {
      party: "payor" as const,
      field: "tin" as const,
      code: "PAYOR_TIN_PRESENT",
      value: value.payor.tin,
      label: "Payor TIN",
      reason: "missing_payor_tin",
    },
  ]) {
    addIdentityCheck({
      checks,
      reasons,
      certificate,
      party: identity.party,
      field: identity.field,
      code: identity.code,
      passed: hasSourceValue(identity.value),
      successMessage: `${identity.label} is present.`,
      failureMessage: `${identity.label} is missing`,
      reason: identity.reason,
    });
  }
  const invalidPeriodStart = reasons.includes("invalid_period_start_date");
  const invalidPeriodEnd = reasons.includes("invalid_period_end_date");
  const invalidPeriodOrder = reasons.includes("period_start_after_end");
  addCheck(
    checks,
    reasons,
    "PERIOD_START_DATE_VALID",
    !invalidPeriodStart,
    "Period start date is a valid calendar date or was not provided.",
    "The period start date is not a valid calendar date.",
    "invalid_period_start_date",
  );
  addCheck(
    checks,
    reasons,
    "PERIOD_END_DATE_VALID",
    !invalidPeriodEnd,
    "Period end date is a valid calendar date or was not provided.",
    "The period end date is not a valid calendar date.",
    "invalid_period_end_date",
  );
  addCheck(
    checks,
    reasons,
    "PERIOD_DATE_ORDER_VALID",
    !invalidPeriodOrder,
    "Period start date is not after the period end date.",
    "The period start date is after the period end date.",
    "period_start_after_end",
  );
  if (!invalidPeriodStart && !invalidPeriodEnd && !invalidPeriodOrder) {
    addCheck(
      checks,
      reasons,
      "PERIOD_COVERED_PRESENT",
      hasSourceValue(value.period.start) &&
        hasSourceValue(value.period.end) &&
        hasSourceValue(value.period.monthOfQuarter),
      "Period covered is present.",
      "Period covered is missing",
      "missing_period_covered",
    );
  }
  addCheck(
    checks,
    reasons,
    "TAX_ROWS_PRESENT",
    value.taxRows.length > 0,
    "At least one tax row is present.",
    "Tax rows are missing",
    "missing_tax_rows",
  );
  addIdentityCheck({
    checks,
    reasons,
    certificate,
    party: "payee",
    field: "tin",
    code: "ENTITY_PAYEE_TIN_MATCH",
    passed: selectedEntityTinMatches(state, certificate),
    successMessage: "Payee TIN matches the selected entity TIN.",
    failureMessage: selectedEntityTinFailureMessage(state, certificate),
    reason: "entity_payee_tin_mismatch",
    referenceCheck: true,
  });
  addIdentityCheck({
    checks,
    reasons,
    certificate,
    party: "payee",
    field: "name",
    code: "ENTITY_PAYEE_NAME_MATCH",
    passed: selectedEntityNameMatches(state, certificate),
    successMessage: "Payee name matches the selected entity company name.",
    failureMessage: selectedEntityNameFailureMessage(state, certificate),
    reason: "entity_payee_name_mismatch",
    referenceCheck: true,
  });
  addCheck(
    checks,
    reasons,
    "PRINTED_NAME_PRESENT",
    Boolean(value.signer.printedName),
    "Payor printed name is present.",
    "Payor printed name not present",
    "missing_printed_name",
  );
  addCheck(
    checks,
    reasons,
    "SIGNATURE_PRESENT",
    value.signer.signature.present === true,
    "Signature is present.",
    "Signature not present",
    "missing_signature",
  );
  addIdentityCheck({
    checks,
    reasons,
    certificate,
    party: "payor",
    field: "tin",
    code: "MASTERLIST_PAYOR_TIN_MATCH",
    passed: input.masterlistLookup.tinLookup.status === "matched",
    successMessage: "Payor TIN matches the masterlist.",
    failureMessage: masterlistTinFailureMessage(
      certificate,
      input.masterlistLookup.tinLookup,
    ),
    reason:
      input.masterlistLookup.tinLookup.status === "error"
        ? "masterlist_lookup_failed"
        : "payor_tin_not_found_in_masterlist",
    referenceCheck: true,
  });
  addIdentityCheck({
    checks,
    reasons,
    certificate,
    party: "payor",
    field: "name",
    code: "MASTERLIST_PAYOR_NAME_MATCH",
    passed: input.masterlistLookup.nameLookup.status === "matched",
    successMessage: "Payor name matches the masterlist.",
    failureMessage: masterlistNameFailureMessage(
      certificate,
      input.masterlistLookup.nameLookup,
    ),
    reason:
      input.masterlistLookup.nameLookup.status === "error"
        ? "masterlist_lookup_failed"
        : "payor_name_not_found_in_masterlist",
    referenceCheck: true,
  });

  if (
    input.masterlistLookup.tinLookup.status === "matched" &&
    input.masterlistLookup.nameLookup.status === "matched"
  ) {
    addCheck(
      checks,
      reasons,
      "MASTERLIST_PAYOR_IDENTITY_MATCH",
      input.masterlistLookup.status === "matched",
      "Payor TIN and name match the same masterlist record.",
      input.masterlistLookup.status === "error"
        ? `Masterlist payor identity lookup failed: ${input.masterlistLookup.error ?? "masterlist_lookup_failed"}`
        : "Payor TIN and name match different masterlist records.",
      input.masterlistLookup.status === "error"
        ? "masterlist_lookup_failed"
        : "masterlist_payor_identity_mismatch",
    );
  }

  if (
    taxRows.some((row) => row.atcCode === "WV020") &&
    input.masterlistLookup.status === "matched"
  ) {
    const government = input.masterlistLookup.matches.some(
      (match) => match.isGovernment,
    );
    addCheck(
      checks,
      reasons,
      "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
      government,
      "WV020 is used only for a government customer.",
      "ATC WV020 is only valid for government customers.",
      "government_customer_required_for_wv020",
    );
  }

  const uniqueReasons = [...new Set(reasons)];
  const hardReasons = uniqueReasons.filter(
    (reason) => !isIdentityReviewReason(reason),
  );
  const hasReviewReasons = hardReasons.length !== uniqueReasons.length;
  return {
    status:
      hardReasons.length > 0
        ? "invalid"
        : hasReviewReasons
          ? "manual_review"
          : "valid",
    reasons: uniqueReasons,
    checks,
    taxRows,
    reconciliationTotals: certificate.reconciliationTotals,
    atcCode,
    atcRate: configuredRule?.rate,
    computedTaxBase: primaryRow?.computedTaxBase,
    reportedTaxBase: primaryRow?.reportedTaxBase,
    variance: primaryRow?.variance,
    threshold: varianceThresholdPhp,
  };
}

async function lookupMasterlist(
  db: DbClient,
  certificate: WorkflowCertificateState,
): Promise<MasterlistLookupResult> {
  const tin = tinPrefix(certificate.effective.payor.tin);
  const normalizedPayorName = normalizeNullableSourceString(
    certificate.effective.payor.name,
  );
  const name = normalizeIdentityName(normalizedPayorName);
  const tinUnresolved =
    identityNeedsReview(certificate, "payor", "tin") ||
    identityIsConfirmedBlank(certificate, "payor", "tin");
  const nameUnresolved =
    identityNeedsReview(certificate, "payor", "name") ||
    identityIsConfirmedBlank(certificate, "payor", "name");
  const skippedLookup = (): MasterlistFieldLookupResult => ({
    status: "skipped",
    matchCount: 0,
    matches: [],
  });
  const runLookup = async (
    query: string,
    condition: SQL,
  ): Promise<MasterlistFieldLookupResult> => {
    try {
      const matches = await db
        .select()
        .from(masterlist)
        .where(condition)
        .orderBy(asc(masterlist.shortName), asc(masterlist.customerName))
        .limit(10);
      return {
        status: matches.length > 0 ? "matched" : "not_found",
        query,
        matchCount: matches.length,
        matches,
      };
    } catch (error) {
      return {
        status: "error",
        query,
        matchCount: 0,
        matches: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const [tinLookup, nameLookup] = await Promise.all([
    tinUnresolved
      ? Promise.resolve(skippedLookup())
      : lookupMasterlistTin(db, certificate.effective.payor.tin),
    !nameUnresolved && name
      ? runLookup(
          normalizedPayorName ?? name,
          sql`${compactIdentityNameSql(masterlist.customerName)} ILIKE ${`%${name}%`}`,
        )
      : Promise.resolve(skippedLookup()),
  ]);
  const baseResult = {
    payorName: certificate.effective.payor.name,
    payorTin: certificate.effective.payor.tin,
    tinLookup,
    nameLookup,
  };
  const fieldErrors = [tinLookup.error, nameLookup.error].filter(
    (error): error is string => Boolean(error),
  );

  if (fieldErrors.length > 0) {
    return {
      ...baseResult,
      status: "error",
      matchCount: 0,
      matches: [],
      error: [...new Set(fieldErrors)].join("; "),
    };
  }

  if (
    tinUnresolved ||
    nameUnresolved ||
    (tinLookup.status === "skipped" && nameLookup.status === "skipped")
  ) {
    return {
      ...baseResult,
      status: "skipped",
      matchCount: 0,
      matches: [],
    };
  }

  if (tinLookup.status !== "matched" || nameLookup.status !== "matched") {
    return {
      ...baseResult,
      status: "not_found",
      matchCount: 0,
      matches: [],
    };
  }

  const identityQuery = `${tin}|${normalizedPayorName ?? name ?? ""}`;
  const identityCondition = and(
    sql`regexp_replace(coalesce(${masterlist.tin}, ''), '[^0-9]', '', 'g') like ${`${tin}%`}`,
    sql`${compactIdentityNameSql(masterlist.customerName)} ILIKE ${`%${name}%`}`,
  );
  if (!identityCondition) {
    return {
      ...baseResult,
      status: "not_found",
      query: identityQuery,
      matchCount: 0,
      matches: [],
    };
  }

  const identityLookup = await runLookup(identityQuery, identityCondition);
  return {
    ...baseResult,
    status: identityLookup.status,
    query: identityLookup.query,
    matchCount: identityLookup.matchCount,
    matches: identityLookup.matches,
    error: identityLookup.error,
  };
}

export function createProcessCertificatesNode(deps: ProcessCertificatesDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    if (!state.extractionResult) {
      return {
        documentStatus: "error",
        decision: {
          terminalStatus: "Error",
          route: "continue",
          documentStatus: "error",
          reasonCodes: state.reasonCodes ?? ["missing_extraction_result"],
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }
    if ((state.certificates ?? []).length === 0) {
      const documentStatus = state.documentStatus ?? "error";
      return {
        decision: {
          terminalStatus: documentStatus === "error" ? "Error" : "Done",
          route: "continue",
          documentStatus,
          reasonCodes: state.reasonCodes ?? [],
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    const atcRules = await deps.getAtcRules();
    const multipleCertificatesDetected =
      (state.certificateSelection?.detectedCount ?? 0) > 1;
    const certificates: WorkflowCertificateState[] = [];
    for (const sourceCertificate of state.certificates ?? []) {
      let certificate = prepareCertificateTaxData(
        sourceCertificate,
        atcRules,
        deps.varianceThresholdPhp,
      );
      if (
        !multipleCertificatesDetected &&
        deps.identityConfidenceFlowEnabled !== false
      ) {
        const resolution = await resolveIdentityFieldConfidence({
          certificate: certificate.effective,
          certificatePdf: certificate.certificatePdfBase64
            ? Buffer.from(certificate.certificatePdfBase64, "base64")
            : undefined,
          extractionClient: deps.extractionClient,
          regionRenderer: deps.pdfRegionRenderer,
          sourceFileId: state.event.sourceFileId,
          revision: `${state.event.revision}-certificate-${certificate.ordinal}`,
          logger: deps.logger,
        });
        const reviewReasons = resolution.decisions
          .filter((decision) => decision.status === "manual_review")
          .flatMap((decision) => [
            identityReviewReason(decision),
            identityRereadFailureReason(decision),
          ])
          .filter((reason): reason is string => Boolean(reason));
        certificate = {
          ...certificate,
          effective: resolution.effective,
          identityFieldDecisions: resolution.decisions,
          reasonCodes: [
            ...new Set([...certificate.reasonCodes, ...reviewReasons]),
          ],
        };
      }
      const masterlistLookup = await lookupMasterlist(deps.db, certificate);
      certificate = {
        ...certificate,
        identityFieldDecisions: certificate.identityFieldDecisions?.map(
          (decision) => ({
            ...decision,
            referenceStatus:
              decision.status === "manual_review" ||
              decision.status === "confirmed_blank"
                ? "skipped"
                : decision.party === "payee"
                  ? (
                      decision.field === "tin"
                        ? selectedEntityTinMatches(state, certificate)
                        : selectedEntityNameMatches(state, certificate)
                    )
                    ? "matched"
                    : "mismatched"
                  : (decision.field === "tin"
                        ? masterlistLookup.tinLookup.status
                        : masterlistLookup.nameLookup.status) === "matched"
                    ? "matched"
                    : (decision.field === "tin"
                          ? masterlistLookup.tinLookup.status
                          : masterlistLookup.nameLookup.status) === "error"
                      ? "error"
                      : "mismatched",
          }),
        ),
      };
      const selectedEntityIdentityMatched =
        selectedEntityTinMatches(state, certificate) &&
        selectedEntityNameMatches(state, certificate);
      const payeeShortName = selectedEntityIdentityMatched
        ? normalizeNullableSourceString(
            state.event.selectedEntity?.shortName ?? null,
          )
        : null;
      const payorShortName =
        masterlistLookup.status === "matched"
          ? normalizeNullableSourceString(
              masterlistLookup.matches[0]?.shortName ?? null,
            )
          : null;
      const fingerprint = buildCertificateFingerprint(certificate.effective);
      const normalValidation = validateCertificate({
        state,
        certificate,
        atcRules,
        varianceThresholdPhp: deps.varianceThresholdPhp,
        masterlistLookup,
      });
      const validation: ValidationResult = multipleCertificatesDetected
        ? {
            ...normalValidation,
            status: "invalid",
            reasons: [
              ...new Set([
                ...normalValidation.reasons,
                MULTIPLE_CERTIFICATES_REASON_CODE,
              ]),
            ],
          }
        : normalValidation;
      const hasValidationError =
        multipleCertificatesDetected ||
        certificate.status === "error" ||
        validation.status === "invalid";
      const needsManualReview = validation.status === "manual_review";
      const [sourceDuplicate, certificateDuplicate] =
        hasValidationError || needsManualReview
          ? [[], []]
          : await Promise.all([
              state.source?.hash
                ? deps.db
                    .select({ id: documentResults.id })
                    .from(documentResults)
                    .where(
                      and(
                        eq(documentResults.sourceHash, state.source.hash),
                        eq(documentResults.status, "accepted"),
                        ne(documentResults.uploadId, state.event.uploadId),
                      ),
                    )
                    .orderBy(
                      asc(documentResults.createdAt),
                      asc(documentResults.id),
                    )
                    .limit(1)
                : Promise.resolve([]),
              deps.db
                .select({ id: extractedCertificates.id })
                .from(extractedCertificates)
                .innerJoin(
                  documentResults,
                  eq(
                    documentResults.id,
                    extractedCertificates.documentResultId,
                  ),
                )
                .where(
                  and(
                    eq(extractedCertificates.fingerprint, fingerprint),
                    eq(extractedCertificates.status, "accepted"),
                    eq(documentResults.status, "accepted"),
                    ne(documentResults.uploadId, state.event.uploadId),
                  ),
                )
                .orderBy(
                  asc(extractedCertificates.createdAt),
                  asc(extractedCertificates.id),
                )
                .limit(1),
            ]);
      const duplicateReasons = [
        ...(sourceDuplicate.length > 0 ? ["duplicate_source_document"] : []),
        ...(certificateDuplicate.length > 0 ? ["duplicate_certificate"] : []),
      ];
      const isDuplicate = duplicateReasons.length > 0;
      const validationReasons = multipleCertificatesDetected
        ? [
            ...new Set([
              ...validation.reasons,
              MULTIPLE_CERTIFICATES_REASON_CODE,
            ]),
          ]
        : validation.reasons;
      certificates.push({
        ...certificate,
        status: hasValidationError
          ? "error"
          : needsManualReview
            ? "manual_review"
            : isDuplicate
              ? "duplicate"
              : "accepted",
        reasonCodes: isDuplicate
          ? [...new Set([...validationReasons, ...duplicateReasons])]
          : validationReasons,
        validation,
        masterlistLookup,
        payeeShortName,
        payorShortName,
        fingerprint,
        duplicateOfCertificateId: multipleCertificatesDetected
          ? undefined
          : certificateDuplicate[0]?.id,
      });
    }

    const allDuplicate = certificates.every(
      (certificate) => certificate.status === "duplicate",
    );
    const anyError = certificates.some(
      (certificate) => certificate.status === "error",
    );
    const anyManualReview = certificates.some(
      (certificate) => certificate.status === "manual_review",
    );
    const anyAccepted = certificates.some(
      (certificate) => certificate.status === "accepted",
    );
    const documentStatus = multipleCertificatesDetected
      ? "error"
      : anyError
        ? "error"
        : anyManualReview
          ? "manual_review"
          : allDuplicate
            ? "duplicate"
            : anyAccepted
              ? "accepted"
              : "error";
    const reasonCodes = [
      ...new Set([
        ...(state.reasonCodes ?? []),
        ...(multipleCertificatesDetected
          ? [MULTIPLE_CERTIFICATES_REASON_CODE]
          : []),
        ...certificates.flatMap((certificate) => certificate.reasonCodes),
      ]),
    ];
    deps.logger.info("certificate_processing_completed", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      certificateCount: certificates.length,
      acceptedCount: certificates.filter(
        (certificate) => certificate.status === "accepted",
      ).length,
      errorCount: certificates.filter(
        (certificate) => certificate.status === "error",
      ).length,
      manualReviewCount: certificates.filter(
        (certificate) => certificate.status === "manual_review",
      ).length,
      duplicateCount: certificates.filter(
        (certificate) => certificate.status === "duplicate",
      ).length,
    });

    return {
      certificates,
      documentStatus,
      reasonCodes,
      decision: {
        terminalStatus: multipleCertificatesDetected
          ? "Error"
          : allDuplicate
            ? "Duplicate"
            : documentStatus === "error"
              ? "Error"
              : "Done",
        route: "continue",
        documentStatus,
        reasonCodes,
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
    };
  };
}
