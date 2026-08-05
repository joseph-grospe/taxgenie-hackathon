import { createHash } from "node:crypto";
import type { ExtractedCertificate } from "../services/extractionContract";
import type { EffectiveCertificate } from "../types";
import { normalizeAtcCode } from "./atc";

const MISSING_SOURCE_VALUE_PATTERN =
  /^(?:n\/?a|none|null|unknown|not\s+(?:available|applicable|provided)|blank|-+)$/iu;

export function normalizeNullableSourceString(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > 0 && !MISSING_SOURCE_VALUE_PATTERN.test(normalized)
    ? normalized
    : null;
}

function trimNullable(value: string | null): string | null {
  return normalizeNullableSourceString(value);
}

function normalizeTin(value: string | null): string | null {
  const sourceValue = normalizeNullableSourceString(value);
  if (sourceValue === null) {
    return null;
  }
  const digits = sourceValue.replace(/\D/gu, "");
  return digits.length > 0 ? digits : null;
}

function decimal(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? value : null;
}

const MONTHS_OF_QUARTER = ["first", "second", "third"] as const;

function resolveMonthOfQuarter(
  certificate: ExtractedCertificate,
): ExtractedCertificate["period"]["monthOfQuarter"] {
  const nonZeroMonths = MONTHS_OF_QUARTER.filter((month) =>
    certificate.taxRows.some((row) => {
      const value = row.monthlyAmounts[month];
      return value !== null && Number(value) !== 0;
    }),
  );

  if (nonZeroMonths.length === 1) {
    return nonZeroMonths[0]!;
  }
  return null;
}

export function canonicalizeExtractedCertificate(
  certificate: ExtractedCertificate,
): ExtractedCertificate {
  return {
    ...certificate,
    certificateKey: certificate.certificateKey.trim(),
    pageNumbers: [...certificate.pageNumbers],
    period: {
      ...certificate.period,
      monthOfQuarter: resolveMonthOfQuarter(certificate),
    },
    payee: {
      name: trimNullable(certificate.payee.name),
      tin: normalizeTin(certificate.payee.tin),
      address: trimNullable(certificate.payee.address),
      zip: normalizeTin(certificate.payee.zip),
    },
    payor: {
      name: trimNullable(certificate.payor.name),
      tin: normalizeTin(certificate.payor.tin),
      address: trimNullable(certificate.payor.address),
      zip: normalizeTin(certificate.payor.zip),
    },
    taxRows: certificate.taxRows.map((row) => ({
      ...row,
      atcCode:
        normalizeAtcCode(row.atcCode) ??
        trimNullable(row.atcCode)?.toUpperCase() ??
        null,
      description: trimNullable(row.description),
      monthlyAmounts: {
        first:
          row.monthlyAmounts.first === null
            ? null
            : decimal(row.monthlyAmounts.first),
        second:
          row.monthlyAmounts.second === null
            ? null
            : decimal(row.monthlyAmounts.second),
        third:
          row.monthlyAmounts.third === null
            ? null
            : decimal(row.monthlyAmounts.third),
      },
      taxBase: decimal(row.taxBase),
      taxRate: decimal(row.taxRate),
      taxWithheld: decimal(row.taxWithheld),
    })),
    primaryAtcCode:
      normalizeAtcCode(certificate.primaryAtcCode) ??
      trimNullable(certificate.primaryAtcCode)?.toUpperCase() ??
      null,
    totals: {
      taxBase: decimal(certificate.totals.taxBase),
      taxWithheld: decimal(certificate.totals.taxWithheld),
    },
    signer: {
      printedName: trimNullable(certificate.signer.printedName),
      title: trimNullable(certificate.signer.title),
      tin: normalizeTin(certificate.signer.tin),
      companyName: trimNullable(certificate.signer.companyName),
      signature: { ...certificate.signer.signature },
    },
    confidence: { ...certificate.confidence },
    evidence: Object.fromEntries(
      Object.entries(certificate.evidence).map(([key, evidence]) => [
        key,
        {
          ...evidence,
          section: evidence.section.trim(),
          excerpt: evidence.excerpt.trim().slice(0, 200),
        },
      ]),
    ),
    warnings: certificate.warnings.map((warning) =>
      warning.trim().slice(0, 200),
    ),
  };
}

export function buildCertificateFingerprint(
  certificate: ExtractedCertificate | EffectiveCertificate,
): string {
  const decimalFingerprint = (value: string | null) =>
    value === null ? null : Number(value).toFixed(2);
  const canonical = {
    periodStart: certificate.period.start,
    periodEnd: certificate.period.end,
    payeeName: certificate.payee.name?.toLowerCase() ?? null,
    payeeTin: certificate.payee.tin,
    payorName: certificate.payor.name?.toLowerCase() ?? null,
    payorTin: certificate.payor.tin,
    primaryAtcCode: certificate.primaryAtcCode,
    totalTaxBase: decimalFingerprint(certificate.totals.taxBase),
    totalTaxWithheld: decimalFingerprint(certificate.totals.taxWithheld),
    taxRows: certificate.taxRows.map((row) => ({
      atcCode: row.atcCode,
      taxBase: decimalFingerprint(row.taxBase),
      taxWithheld: decimalFingerprint(row.taxWithheld),
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface RecoveredSignerFields {
  printedName?: string;
  title?: string;
  tin?: string;
}

const LABEL_PATTERN =
  /\b(?:signature\s+over\s+printed\s+name|authorized\s+representative|tax\s+agent|conforme|date\s+signed)\b/iu;
const TITLE_PATTERN =
  /\b(?:manager|director|officer|accountant|treasurer|president|vice president|vp|head|supervisor|controller|agent|representative)\b/iu;

export function recoverSignerFieldsFromText(
  text: string,
): RecoveredSignerFields {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const labelIndex = lines.findIndex((line) => LABEL_PATTERN.test(line));
  const window =
    labelIndex >= 0
      ? lines.slice(Math.max(0, labelIndex - 5), labelIndex + 3)
      : lines.slice(-12);
  const tin = window
    .map((line) => line.match(/\b(?:\d[\s-]*){9,14}\b/u)?.[0])
    .find(Boolean)
    ?.replace(/\D/gu, "");
  const title = window.find(
    (line) =>
      TITLE_PATTERN.test(line) &&
      !LABEL_PATTERN.test(line) &&
      line.length <= 100,
  );
  const printedName = [...window]
    .reverse()
    .find(
      (line) =>
        !LABEL_PATTERN.test(line) &&
        !TITLE_PATTERN.test(line) &&
        !/^\d[\d\s-]+$/u.test(line) &&
        /^[\p{L}][\p{L} .,'-]{3,100}$/u.test(line) &&
        line.split(/\s+/u).length >= 2,
    );

  return {
    printedName,
    title,
    tin: tin && tin.length >= 9 ? tin : undefined,
  };
}
