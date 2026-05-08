import {
  normalizeIssuerShortname,
  parseCertificateFileName,
} from "@taxtrack/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "./client";
import { reconciliationResults } from "./schema";

type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const roundMoney = (value: number) => Number(value.toFixed(2));

const MONEY_TOLERANCE = 0.01;

export const toReconciliationNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundMoney(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/gu, ""));
    if (Number.isFinite(parsed)) {
      return roundMoney(parsed);
    }
  }

  return null;
};

const toBillingMonthMMYY = (periodEnd: unknown): string | null => {
  if (typeof periodEnd !== "string") {
    return null;
  }

  const isoMatch = periodEnd.match(/^(\d{4})-(\d{2})-\d{2}$/u);
  if (isoMatch) {
    return `${isoMatch[2]}${isoMatch[1]?.slice(-2)}`;
  }

  const monthDayYearMatch = periodEnd.match(/^(\d{2})[-/]\d{2}[-/](\d{4})$/u);
  if (monthDayYearMatch) {
    return `${monthDayYearMatch[1]}${monthDayYearMatch[2]?.slice(-2)}`;
  }

  return null;
};

const computeDifferences = (input: {
  taxBase: number;
  taxWithheld: number;
  taxableSales: number;
  prepaidCWT: number;
}) => {
  const taxBaseDifference = roundMoney(input.taxBase - input.taxableSales);
  const taxWithheldDifference = roundMoney(
    input.taxWithheld - Math.abs(input.prepaidCWT),
  );

  return {
    taxBaseDifference,
    taxWithheldDifference,
    hasDifference: taxBaseDifference !== 0 || taxWithheldDifference !== 0,
  };
};

const isExactMoneyMatch = (left: number, right: number) =>
  Math.abs(roundMoney(left) - roundMoney(right)) <= MONEY_TOLERANCE;

export const resolveAutomaticReconciliationMatchInput = (input: {
  originalFileName: string;
  normalized: Record<string, unknown>;
  payorShortName: string | null;
}) => {
  const metadata = parseCertificateFileName(input.originalFileName);
  const issuerShortName = input.payorShortName?.trim() || null;
  const billingMonthMMYY =
    metadata?.billingMonthMMYY ??
    toBillingMonthMMYY(
      input.normalized.periodEnd ?? input.normalized.periodCovered,
    );
  const taxBase = toReconciliationNumberValue(input.normalized.taxBase);
  const taxWithheld = toReconciliationNumberValue(input.normalized.taxWithheld);

  if (
    !issuerShortName ||
    !billingMonthMMYY ||
    taxBase === null ||
    taxWithheld === null
  ) {
    return null;
  }

  return {
    issuerShortName: normalizeIssuerShortname(issuerShortName),
    billingMonthMMYY,
    taxBase,
    taxWithheld,
  };
};

export const applyAutomaticReconciliationMatch = async (
  tx: DbTransaction,
  input: {
    batchId: string;
    documentResultId: number;
    issuerShortName: string;
    billingMonthMMYY: string;
    taxBase: number;
    taxWithheld: number;
  },
) => {
  const rows = await tx
    .select()
    .from(reconciliationResults)
    .where(
      and(
        eq(reconciliationResults.uploadBatchId, input.batchId),
        eq(reconciliationResults.matchStatus, "unmatched"),
        isNull(reconciliationResults.matchedTaxRecordId),
        eq(
          reconciliationResults.issuerShortnameUsedForMatch,
          input.issuerShortName,
        ),
        eq(
          reconciliationResults.derivedBillingMonthMMYY,
          input.billingMonthMMYY,
        ),
      ),
    )
    .orderBy(
      asc(reconciliationResults.customerName),
      asc(reconciliationResults.invoiceNumber),
      asc(reconciliationResults.id),
    );

  const candidates = rows.filter(
    (row) =>
      isExactMoneyMatch(input.taxBase, row.taxableSales) &&
      isExactMoneyMatch(input.taxWithheld, Math.abs(row.prepaidCWT)),
  );

  if (candidates.length !== 1) {
    return { status: "skipped" as const, candidateCount: candidates.length };
  }

  const row = candidates[0];
  const difference = computeDifferences({
    taxBase: input.taxBase,
    taxWithheld: input.taxWithheld,
    taxableSales: row.taxableSales,
    prepaidCWT: row.prepaidCWT,
  });
  const updatedRows = await tx
    .update(reconciliationResults)
    .set({
      matchedTaxRecordId: input.documentResultId,
      taxBase: input.taxBase,
      taxWithheld: input.taxWithheld,
      taxBaseDifference: difference.taxBaseDifference,
      taxWithheldDifference: difference.taxWithheldDifference,
      hasDifference: difference.hasDifference,
      matchStatus: "matched",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reconciliationResults.id, row.id),
        eq(reconciliationResults.uploadBatchId, input.batchId),
        isNull(reconciliationResults.matchedTaxRecordId),
        eq(reconciliationResults.matchStatus, "unmatched"),
      ),
    )
    .returning({ id: reconciliationResults.id });

  return updatedRows.length === 1
    ? { status: "matched" as const, rowId: row.id }
    : { status: "skipped" as const, candidateCount: candidates.length };
};
