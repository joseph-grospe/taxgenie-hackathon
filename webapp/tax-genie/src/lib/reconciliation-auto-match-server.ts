import { parseCertificateFileName } from '@taxgenie/shared'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import {
  reconciliationResultCollections,
  reconciliationResults,
  salesReportRunBatches,
  salesReportRuns,
} from '@/lib/schema'

type DbClient = ReturnType<typeof getDb>
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0]

type CertificateMatchMetadata = {
  documentType: string | null
  normalizedIssuerShortname: string | null
  billingMonthMMYY: string | null
}

const roundMoney = (value: number) => Number(value.toFixed(2))

const toMoney = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return roundMoney(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/gu, ''))
    return Number.isFinite(parsed) ? roundMoney(parsed) : null
  }
  return null
}

const resolveMatchInput = (input: {
  originalFileName: string
  normalized: Record<string, unknown>
  metadata?: CertificateMatchMetadata | null
}) => {
  const parsed = parseCertificateFileName(input.originalFileName)
  const metadata = input.metadata ?? parsed
  if (metadata?.documentType?.toUpperCase() !== 'BIR2307') return null
  if (!metadata.normalizedIssuerShortname || !metadata.billingMonthMMYY) {
    return null
  }
  return {
    issuerShortName: metadata.normalizedIssuerShortname,
    billingMonthMMYY: metadata.billingMonthMMYY,
    settlementReferenceNumber: parsed?.settlementReferenceNumber ?? null,
    taxBase: toMoney(input.normalized.taxBase),
    taxWithheld: toMoney(input.normalized.taxWithheld),
  }
}

const computeDifferences = (input: {
  taxBase: number
  taxWithheld: number
  taxableSales: number
  prepaidCWT: number
}) => {
  const taxBaseDifference = roundMoney(input.taxBase - input.taxableSales)
  const taxWithheldDifference = roundMoney(
    input.taxWithheld - Math.abs(input.prepaidCWT),
  )
  return {
    taxBaseDifference,
    taxWithheldDifference,
    hasDifference: taxBaseDifference !== 0 || taxWithheldDifference !== 0,
  }
}

const normalizeAmount = (value: number | null | undefined) =>
  Number.isFinite(value) ? roundMoney(value ?? 0) : 0

const varianceTotal = (difference: ReturnType<typeof computeDifferences>) =>
  roundMoney(
    Math.abs(difference.taxBaseDifference) +
      Math.abs(difference.taxWithheldDifference),
  )

const normalizeReference = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? ''

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
    ).at(0)
    await tx
      .update(salesReportRuns)
      .set({
        matchedCount: Number(summary?.matchedCount ?? 0),
        unmatchedCount: Number(summary?.unmatchedCount ?? 0),
        varianceTotal: roundMoney(Number(summary?.varianceTotal ?? 0)),
        updatedAt,
      })
      .where(eq(salesReportRuns.id, runId))
  }
}

export const applyAutomaticReconciliationAfterCorrection = async (input: {
  batchId: string
  certificateId: number
  uploadId: string
  sourceFileId: string
  originalFileName: string
  normalized: Record<string, unknown>
  metadata?: CertificateMatchMetadata | null
}) => {
  const matchInput = resolveMatchInput(input)
  if (!matchInput) return { status: 'skipped' as const, rowCount: 0 }

  return getDb().transaction(async (tx) => {
    const alreadyLinked = await tx
      .select({ id: reconciliationResultCollections.id })
      .from(reconciliationResultCollections)
      .where(
        and(
          eq(reconciliationResultCollections.certificateId, input.certificateId),
          isNull(reconciliationResultCollections.archivedAt),
        ),
      )
      .limit(1)
    if (alreadyLinked.length > 0) {
      return { status: 'skipped' as const, rowCount: 0 }
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
      )
    const options = rows.flatMap((row) => {
      if (!row.salesReportRunId) return []
      const currentTaxBase = normalizeAmount(row.taxBase)
      const currentTaxWithheld = normalizeAmount(row.taxWithheld)
      const currentDifference = computeDifferences({
        taxBase: currentTaxBase,
        taxWithheld: currentTaxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      })
      const currentVariance = varianceTotal(currentDifference)
      if (currentVariance <= 0) return []
      const aggregateTaxBase = roundMoney(
        currentTaxBase + normalizeAmount(matchInput.taxBase),
      )
      const aggregateTaxWithheld = roundMoney(
        currentTaxWithheld + normalizeAmount(matchInput.taxWithheld),
      )
      const difference = computeDifferences({
        taxBase: aggregateTaxBase,
        taxWithheld: aggregateTaxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      })
      const improvement = roundMoney(
        currentVariance - varianceTotal(difference),
      )
      if (improvement <= 0) return []
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
      ]
    })
    const best = options.sort((left, right) => {
      if (left.improvement !== right.improvement) {
        return right.improvement - left.improvement
      }
      if (left.exactReference !== right.exactReference) {
        return left.exactReference ? -1 : 1
      }
      if (left.rowOrder !== right.rowOrder) return left.rowOrder - right.rowOrder
      return left.row.id - right.row.id
    })[0]
    if (!best?.row.salesReportRunId) {
      return { status: 'skipped' as const, rowCount: 0 }
    }

    const matchedAt = new Date()
    await tx.insert(reconciliationResultCollections).values({
      reconciliationResultId: best.row.id,
      certificateId: input.certificateId,
      batchId: input.batchId,
      uploadId: input.uploadId,
      sourceFileId: input.sourceFileId,
      taxBase: matchInput.taxBase,
      taxWithheld: matchInput.taxWithheld,
      appliedAt: matchedAt,
      createdAt: matchedAt,
      updatedAt: matchedAt,
    })
    const shouldReopenEmail =
      Boolean(best.row.emailSentAt) &&
      best.difference.hasDifference &&
      (best.difference.taxBaseDifference !== best.row.taxBaseDifference ||
        best.difference.taxWithheldDifference !==
          best.row.taxWithheldDifference)
    const matchStatus = best.difference.hasDifference ? 'unmatched' : 'matched'
    const updated = (
      await tx
        .update(reconciliationResults)
        .set({
          matchedUploadBatchId: input.batchId,
          matchedCertificateId: input.certificateId,
          taxBase: best.aggregateTaxBase,
          taxWithheld: best.aggregateTaxWithheld,
          taxBaseDifference: best.difference.taxBaseDifference,
          taxWithheldDifference: best.difference.taxWithheldDifference,
          hasDifference: best.difference.hasDifference,
          matchStatus,
          matchedAt: matchStatus === 'matched' ? matchedAt : null,
          emailSentAt: shouldReopenEmail ? null : best.row.emailSentAt,
          updatedAt: matchedAt,
        })
        .where(
          and(
            eq(reconciliationResults.id, best.row.id),
            isNull(reconciliationResults.archivedAt),
          ),
        )
        .returning({ salesReportRunId: reconciliationResults.salesReportRunId })
    ).at(0)
    if (!updated?.salesReportRunId) {
      return { status: 'skipped' as const, rowCount: 0 }
    }
    await refreshRunSummaries(tx, [updated.salesReportRunId], matchedAt)
    return {
      status: matchStatus === 'matched' ? ('matched' as const) : ('linked' as const),
      rowCount: matchStatus === 'matched' ? 1 : 0,
    }
  })
}
