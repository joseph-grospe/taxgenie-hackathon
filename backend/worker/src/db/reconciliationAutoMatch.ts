import { parseCertificateFileName } from "@taxtrack/shared";
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { DbClient } from "./client";
import {
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
  const metadata =
    input.metadata ?? parseCertificateFileName(input.originalFileName);
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
    taxBase: toReconciliationNumberValue(input.normalized.taxBase),
    taxWithheld: toReconciliationNumberValue(input.normalized.taxWithheld),
  };
};

const computeDifferences = (input: {
  taxBase: number | null;
  taxWithheld: number | null;
  taxableSales: number;
  prepaidCWT: number;
}) => {
  const taxBaseDifference = roundMoney(
    (input.taxBase ?? 0) - input.taxableSales,
  );
  const taxWithheldDifference = roundMoney(
    (input.taxWithheld ?? 0) - Math.abs(input.prepaidCWT),
  );

  return {
    taxBaseDifference,
    taxWithheldDifference,
    hasDifference: taxBaseDifference !== 0 || taxWithheldDifference !== 0,
  };
};

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
    const rows = await tx
      .select({
        id: reconciliationResults.id,
        salesReportRunId: reconciliationResults.salesReportRunId,
        taxableSales: reconciliationResults.taxableSales,
        prepaidCWT: reconciliationResults.prepaidCWT,
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
          eq(reconciliationResults.matchStatus, "unmatched"),
          isNull(reconciliationResults.matchedTaxRecordId),
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

    const matchedAt = new Date();
    const updatedRunIds = new Set<string>();
    let rowCount = 0;

    for (const row of rows) {
      if (!row.salesReportRunId) {
        continue;
      }

      const difference = computeDifferences({
        taxBase: matchInput.taxBase,
        taxWithheld: matchInput.taxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      });
      const updatedRows = await tx
        .update(reconciliationResults)
        .set({
          matchedUploadBatchId: input.batchId,
          matchedTaxRecordId: input.documentResultId,
          taxBase: matchInput.taxBase,
          taxWithheld: matchInput.taxWithheld,
          taxBaseDifference: difference.taxBaseDifference,
          taxWithheldDifference: difference.taxWithheldDifference,
          hasDifference: difference.hasDifference,
          matchStatus: "matched",
          matchedAt,
          updatedAt: matchedAt,
        })
        .where(
          and(
            eq(reconciliationResults.id, row.id),
            isNull(reconciliationResults.archivedAt),
            eq(reconciliationResults.matchStatus, "unmatched"),
            isNull(reconciliationResults.matchedTaxRecordId),
          ),
        )
        .returning({
          id: reconciliationResults.id,
          salesReportRunId: reconciliationResults.salesReportRunId,
        });

      const updated = updatedRows.at(0);
      if (updated?.salesReportRunId) {
        rowCount += 1;
        updatedRunIds.add(updated.salesReportRunId);
      }
    }

    const runIds = Array.from(updatedRunIds);
    if (rowCount === 0) {
      return { status: "skipped" as const, rowCount: 0, runIds: [] };
    }

    await refreshRunSummaries(tx, runIds, matchedAt);

    return {
      status: "matched" as const,
      rowCount,
      runIds,
    };
  });
};
