import { parseCertificateFileName } from "@taxtrack/shared";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import {
  reconciliationResultCollections,
  reconciliationResults,
  salesReportRunBatches,
  salesReportRuns,
} from "./schema";
import type { CertificateMatchMetadata } from "../langgraph/utils/certificateMetadata";

type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export type AutomaticReconciliationMatchResult =
  | {
      status: "matched";
      rowCount: number;
      runIds: Array<string>;
    }
  | {
      status: "skipped";
      rowCount: 0;
      runIds: [];
    };

const roundMoney = (value: number) => Number(value.toFixed(2));

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

export const resolveAutomaticReconciliationMatchInput = (input: {
  originalFileName: string;
  normalized: Record<string, unknown>;
  metadata?: CertificateMatchMetadata | null;
}) => {
  const parsedMetadata = parseCertificateFileName(input.originalFileName);
  const metadata = input.metadata ?? parsedMetadata;
  if (
    !metadata?.documentType ||
    metadata.documentType.toUpperCase() !== "BIR2307"
  ) {
    return null;
  }

  const issuerShortName = metadata.normalizedIssuerShortname;
  if (!issuerShortName) {
    return null;
  }
  const billingMonthMMYY = metadata.billingMonthMMYY;
  if (!billingMonthMMYY) {
    return null;
  }

  return {
    issuerShortName,
    billingMonthMMYY,
    settlementReferenceNumber:
      parsedMetadata?.settlementReferenceNumber ?? null,
    taxBase: toReconciliationNumberValue(input.normalized.taxBase),
    taxWithheld: toReconciliationNumberValue(input.normalized.taxWithheld),
  };
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

const normalizeAmount = (value: number | null | undefined) =>
  Number.isFinite(value) ? roundMoney(value ?? 0) : 0;

const getVarianceTotal = (difference: ReturnType<typeof computeDifferences>) =>
  roundMoney(
    Math.abs(difference.taxBaseDifference) +
      Math.abs(difference.taxWithheldDifference),
  );

const normalizeReference = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? "";

const refreshRunSummaries = async (
  tx: DbTransaction,
  runIds: Array<string>,
  updatedAt: Date,
) => {
  for (const runId of runIds) {
    const summary = (
      await tx
        .select({
          matchedCount: sql<number>`count(*) filter (where ${reconciliationResults.matchStatus} = 'matched')::int`,
          unmatchedCount: sql<number>`count(*) filter (where ${reconciliationResults.matchStatus} = 'unmatched')::int`,
          varianceTotal: sql<number>`coalesce(sum(abs(${reconciliationResults.taxBaseDifference}) + abs(${reconciliationResults.taxWithheldDifference})), 0)::double precision`,
        })
        .from(reconciliationResults)
        .where(
          and(
            eq(reconciliationResults.salesReportRunId, runId),
            isNull(reconciliationResults.archivedAt),
          ),
        )
    ).at(0);

    await tx
      .update(salesReportRuns)
      .set({
        matchedCount: Number(summary?.matchedCount ?? 0),
        unmatchedCount: Number(summary?.unmatchedCount ?? 0),
        varianceTotal: roundMoney(Number(summary?.varianceTotal ?? 0)),
        updatedAt,
      })
      .where(eq(salesReportRuns.id, runId));
  }
};

export const applyAutomaticReconciliationMatch = async (
  db: DbClient,
  input: {
    batchId: string;
    documentResultId: number;
    uploadId: string;
    sourceFileId: string;
    originalFileName: string;
    normalized: Record<string, unknown>;
    metadata?: CertificateMatchMetadata | null;
  },
): Promise<AutomaticReconciliationMatchResult> => {
  const matchInput = resolveAutomaticReconciliationMatchInput({
    originalFileName: input.originalFileName,
    normalized: input.normalized,
    metadata: input.metadata,
  });

  if (!matchInput) {
    return { status: "skipped", rowCount: 0, runIds: [] };
  }

  return db.transaction(async (tx) => {
    const alreadyLinked = await tx
      .select({ id: reconciliationResultCollections.id })
      .from(reconciliationResultCollections)
      .where(
        and(
          eq(
            reconciliationResultCollections.documentResultId,
            input.documentResultId,
          ),
          isNull(reconciliationResultCollections.archivedAt),
        ),
      )
      .limit(1);

    if (alreadyLinked.length > 0) {
      return { status: "skipped" as const, rowCount: 0, runIds: [] };
    }

    const rows = await tx
      .select({
        id: reconciliationResults.id,
        salesReportRunId: reconciliationResults.salesReportRunId,
        salesReportRowId: reconciliationResults.salesReportRowId,
        invoiceNumber: reconciliationResults.invoiceNumber,
        taxableSales: reconciliationResults.taxableSales,
        prepaidCWT: reconciliationResults.prepaidCWT,
        taxBase: reconciliationResults.taxBase,
        taxWithheld: reconciliationResults.taxWithheld,
        taxBaseDifference: reconciliationResults.taxBaseDifference,
        taxWithheldDifference: reconciliationResults.taxWithheldDifference,
        emailSentAt: reconciliationResults.emailSentAt,
      })
      .from(reconciliationResults)
      .innerJoin(
        salesReportRunBatches,
        eq(
          reconciliationResults.salesReportRunId,
          salesReportRunBatches.salesReportRunId,
        ),
      )
      .innerJoin(
        salesReportRuns,
        eq(reconciliationResults.salesReportRunId, salesReportRuns.id),
      )
      .where(
        and(
          eq(salesReportRunBatches.batchId, input.batchId),
          isNull(salesReportRuns.archivedAt),
          isNull(reconciliationResults.archivedAt),
          isNotNull(reconciliationResults.salesReportRunId),
          eq(reconciliationResults.hasDifference, true),
          eq(
            reconciliationResults.issuerShortnameUsedForMatch,
            matchInput.issuerShortName,
          ),
          eq(
            reconciliationResults.derivedBillingMonthMMYY,
            matchInput.billingMonthMMYY,
          ),
        ),
      )
      .orderBy(
        asc(reconciliationResults.salesReportRunId),
        asc(reconciliationResults.id),
      );

    if (rows.length === 0) {
      return { status: "skipped" as const, rowCount: 0, runIds: [] };
    }

    const options = rows.flatMap((row) => {
      if (!row.salesReportRunId) {
        return [];
      }

      const currentTaxBase = normalizeAmount(row.taxBase);
      const currentTaxWithheld = normalizeAmount(row.taxWithheld);
      const currentDifference = computeDifferences({
        taxBase: currentTaxBase,
        taxWithheld: currentTaxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      });
      const currentVariance = getVarianceTotal(currentDifference);
      if (currentVariance <= 0) {
        return [];
      }

      const aggregateTaxBase = roundMoney(
        currentTaxBase + normalizeAmount(matchInput.taxBase),
      );
      const aggregateTaxWithheld = roundMoney(
        currentTaxWithheld + normalizeAmount(matchInput.taxWithheld),
      );
      const difference = computeDifferences({
        taxBase: aggregateTaxBase,
        taxWithheld: aggregateTaxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      });
      const improvement = roundMoney(
        currentVariance - getVarianceTotal(difference),
      );
      if (improvement <= 0) {
        return [];
      }

      return [
        {
          row,
          aggregateTaxBase,
          aggregateTaxWithheld,
          difference,
          improvement,
          exactReference:
            Boolean(matchInput.settlementReferenceNumber) &&
            normalizeReference(row.invoiceNumber) ===
              normalizeReference(matchInput.settlementReferenceNumber),
          rowOrder: row.salesReportRowId ?? row.id,
        },
      ];
    });

    const best = options.sort((left, right) => {
      if (left.improvement !== right.improvement) {
        return right.improvement - left.improvement;
      }

      if (left.exactReference !== right.exactReference) {
        return left.exactReference ? -1 : 1;
      }

      if (left.rowOrder !== right.rowOrder) {
        return left.rowOrder - right.rowOrder;
      }

      return left.row.id - right.row.id;
    })[0];

    if (!best?.row.salesReportRunId) {
      return { status: "skipped" as const, rowCount: 0, runIds: [] };
    }

    const matchedAt = new Date();
    await tx.insert(reconciliationResultCollections).values({
      reconciliationResultId: best.row.id,
      documentResultId: input.documentResultId,
      batchId: input.batchId,
      uploadId: input.uploadId,
      sourceFileId: input.sourceFileId,
      taxBase: matchInput.taxBase,
      taxWithheld: matchInput.taxWithheld,
      appliedAt: matchedAt,
      createdAt: matchedAt,
      updatedAt: matchedAt,
    });

    const shouldReopenEmail =
      Boolean(best.row.emailSentAt) &&
      best.difference.hasDifference &&
      (best.difference.taxBaseDifference !== best.row.taxBaseDifference ||
        best.difference.taxWithheldDifference !==
          best.row.taxWithheldDifference);

    const updatedRows = await tx
      .update(reconciliationResults)
      .set({
        matchedUploadBatchId: input.batchId,
        matchedTaxRecordId: input.documentResultId,
        taxBase: best.aggregateTaxBase,
        taxWithheld: best.aggregateTaxWithheld,
        taxBaseDifference: best.difference.taxBaseDifference,
        taxWithheldDifference: best.difference.taxWithheldDifference,
        hasDifference: best.difference.hasDifference,
        matchStatus: "matched",
        matchedAt,
        emailSentAt: shouldReopenEmail ? null : best.row.emailSentAt,
        updatedAt: matchedAt,
      })
      .where(
        and(
          eq(reconciliationResults.id, best.row.id),
          isNull(reconciliationResults.archivedAt),
        ),
      )
      .returning({
        id: reconciliationResults.id,
        salesReportRunId: reconciliationResults.salesReportRunId,
      });

    const updated = updatedRows.at(0);
    if (!updated?.salesReportRunId) {
      return { status: "skipped" as const, rowCount: 0, runIds: [] };
    }

    const runIds = [updated.salesReportRunId];
    await refreshRunSummaries(tx, runIds, matchedAt);

    return {
      status: "matched" as const,
      rowCount: 1,
      runIds,
    };
  });
};
