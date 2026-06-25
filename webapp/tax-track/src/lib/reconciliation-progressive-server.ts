import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'

import type { TaxRecordCandidate } from '@/lib/reconciliation-server'

import { getDb } from '@/lib/db'
import {
  reconciliationResultCollections,
  reconciliationResults,
  salesReportRunBatches,
  salesReportRuns,
} from '@/lib/schema'

type DbClient = ReturnType<typeof getDb>
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0]

type ReconciliationCollectionTx = DbClient | DbTransaction

type DifferenceValues = {
  taxBaseDifference: number
  taxWithheldDifference: number
  hasDifference: boolean
}

export type ProgressiveReconciliationRowInput = {
  key: string
  rowOrder: number
  issuerShortnameUsedForMatch: string
  derivedBillingMonthMMYY: string
  invoiceNumber: string | null
  taxableSales: number
  prepaidCWT: number
  taxBase?: number | null
  taxWithheld?: number | null
  taxBaseDifference?: number | null
  taxWithheldDifference?: number | null
}

export type ProgressiveReconciliationAssignment = {
  rowKey: string
  candidate: TaxRecordCandidate
  aggregateTaxBase: number
  aggregateTaxWithheld: number
  difference: DifferenceValues
}

const roundMoney = (value: number) => Number(value.toFixed(2))

const normalizeAmount = (value: number | null | undefined) =>
  Number.isFinite(value) ? roundMoney(value ?? 0) : 0

const buildDifferenceValues = (input: {
  taxBase: number
  taxWithheld: number
  taxableSales: number
  prepaidCWT: number
}): DifferenceValues => {
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

const getVarianceTotal = (difference: DifferenceValues) =>
  roundMoney(
    Math.abs(difference.taxBaseDifference) +
      Math.abs(difference.taxWithheldDifference),
  )

const getCandidateUploadedAt = (candidate: TaxRecordCandidate) =>
  (candidate.uploadedAt ?? candidate.fileCreatedAt).getTime()

const isExactReferenceMatch = (
  row: Pick<ProgressiveReconciliationRowInput, 'invoiceNumber'>,
  candidate: TaxRecordCandidate,
) => {
  const invoiceNumber = row.invoiceNumber?.trim().toLowerCase()
  const settlementReference = candidate.metadata.settlementReferenceNumber
    .trim()
    .toLowerCase()

  return Boolean(
    invoiceNumber &&
    settlementReference &&
    invoiceNumber === settlementReference,
  )
}

const candidateMatchesRow = (
  row: ProgressiveReconciliationRowInput,
  candidate: TaxRecordCandidate,
) =>
  candidate.metadata.normalizedIssuerShortname ===
    row.issuerShortnameUsedForMatch &&
  candidate.metadata.billingMonthMMYY === row.derivedBillingMonthMMYY

export const buildProgressiveReconciliationAssignments = (
  rows: Array<ProgressiveReconciliationRowInput>,
  candidates: Array<TaxRecordCandidate>,
  consumedTaxRecordIds: Set<number> = new Set(),
): Array<ProgressiveReconciliationAssignment> => {
  const available = new Map(
    candidates
      .filter((candidate) => !consumedTaxRecordIds.has(candidate.taxRecordId))
      .map((candidate) => [candidate.taxRecordId, candidate]),
  )
  const states = new Map<
    string,
    {
      row: ProgressiveReconciliationRowInput
      aggregateTaxBase: number
      aggregateTaxWithheld: number
      difference: DifferenceValues
    }
  >()
  for (const row of rows) {
    const aggregateTaxBase = normalizeAmount(row.taxBase)
    const aggregateTaxWithheld = normalizeAmount(row.taxWithheld)
    states.set(row.key, {
      row,
      aggregateTaxBase,
      aggregateTaxWithheld,
      difference: buildDifferenceValues({
        taxBase: aggregateTaxBase,
        taxWithheld: aggregateTaxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      }),
    })
  }
  const assignments: Array<ProgressiveReconciliationAssignment> = []

  while (available.size > 0) {
    const options = Array.from(states.values()).flatMap((state) => {
      const currentVariance = getVarianceTotal(state.difference)
      if (currentVariance <= 0) {
        return []
      }

      return Array.from(available.values()).flatMap((candidate) => {
        if (!candidateMatchesRow(state.row, candidate)) {
          return []
        }

        const nextTaxBase = roundMoney(
          state.aggregateTaxBase + normalizeAmount(candidate.taxBase),
        )
        const nextTaxWithheld = roundMoney(
          state.aggregateTaxWithheld + normalizeAmount(candidate.taxWithheld),
        )
        const difference = buildDifferenceValues({
          taxBase: nextTaxBase,
          taxWithheld: nextTaxWithheld,
          taxableSales: state.row.taxableSales,
          prepaidCWT: state.row.prepaidCWT,
        })
        const improvement = roundMoney(
          currentVariance - getVarianceTotal(difference),
        )

        if (improvement <= 0) {
          return []
        }

        return [
          {
            rowKey: state.row.key,
            candidate,
            aggregateTaxBase: nextTaxBase,
            aggregateTaxWithheld: nextTaxWithheld,
            difference,
            improvement,
            exactReference: isExactReferenceMatch(state.row, candidate),
            rowOrder: state.row.rowOrder,
          },
        ]
      })
    })

    const best = options
      .sort((left, right) => {
        if (left.improvement !== right.improvement) {
          return right.improvement - left.improvement
        }

        if (left.exactReference !== right.exactReference) {
          return left.exactReference ? -1 : 1
        }

        if (left.rowOrder !== right.rowOrder) {
          return left.rowOrder - right.rowOrder
        }

        const uploadedDelta =
          getCandidateUploadedAt(right.candidate) -
          getCandidateUploadedAt(left.candidate)
        if (uploadedDelta !== 0) {
          return uploadedDelta
        }

        return left.candidate.taxRecordId - right.candidate.taxRecordId
      })
      .at(0)

    if (!best) {
      break
    }

    const state = states.get(best.rowKey)
    if (!state) {
      break
    }

    state.aggregateTaxBase = best.aggregateTaxBase
    state.aggregateTaxWithheld = best.aggregateTaxWithheld
    state.difference = best.difference
    available.delete(best.candidate.taxRecordId)
    assignments.push({
      rowKey: best.rowKey,
      candidate: best.candidate,
      aggregateTaxBase: best.aggregateTaxBase,
      aggregateTaxWithheld: best.aggregateTaxWithheld,
      difference: best.difference,
    })
  }

  return assignments
}

export const fetchActiveReconciliationCollectionDocumentIds = async (
  taxRecordIds: Array<number>,
  options: { excludeSalesReportId?: string } = {},
): Promise<Set<number>> => {
  const uniqueIds = Array.from(new Set(taxRecordIds))
  if (uniqueIds.length === 0) {
    return new Set()
  }

  const rows = await getDb()
    .select({
      documentResultId: reconciliationResultCollections.documentResultId,
    })
    .from(reconciliationResultCollections)
    .innerJoin(
      reconciliationResults,
      eq(
        reconciliationResultCollections.reconciliationResultId,
        reconciliationResults.id,
      ),
    )
    .where(
      and(
        inArray(reconciliationResultCollections.documentResultId, uniqueIds),
        isNull(reconciliationResultCollections.archivedAt),
        isNull(reconciliationResults.archivedAt),
        options.excludeSalesReportId
          ? ne(
              reconciliationResults.salesReportId,
              options.excludeSalesReportId,
            )
          : undefined,
      ),
    )

  return new Set(rows.map((row) => row.documentResultId))
}

export const archiveReconciliationResultCollectionsForResultIds = async (
  tx: ReconciliationCollectionTx,
  resultIds: Array<number>,
  archivedAt: Date,
) => {
  const uniqueIds = Array.from(new Set(resultIds))
  if (uniqueIds.length === 0) {
    return
  }

  await tx
    .update(reconciliationResultCollections)
    .set({
      archivedAt,
      updatedAt: archivedAt,
    })
    .where(
      and(
        inArray(
          reconciliationResultCollections.reconciliationResultId,
          uniqueIds,
        ),
        isNull(reconciliationResultCollections.archivedAt),
      ),
    )
}

export const fetchActiveReconciliationResultIdsForSalesReport = async (
  tx: ReconciliationCollectionTx,
  salesReportId: string,
  options: { exceptRunId?: string; exceptVersionId?: string } = {},
) => {
  const rows = await tx
    .select({ id: reconciliationResults.id })
    .from(reconciliationResults)
    .where(
      and(
        eq(reconciliationResults.salesReportId, salesReportId),
        isNull(reconciliationResults.archivedAt),
        options.exceptRunId
          ? ne(reconciliationResults.salesReportRunId, options.exceptRunId)
          : undefined,
        options.exceptVersionId
          ? ne(
              reconciliationResults.salesReportVersionId,
              options.exceptVersionId,
            )
          : undefined,
      ),
    )

  return rows.map((row) => row.id)
}

export const insertReconciliationCollectionLinks = async (
  tx: ReconciliationCollectionTx,
  links: Array<{
    reconciliationResultId: number
    candidate: TaxRecordCandidate
    appliedAt: Date
  }>,
) => {
  if (links.length === 0) {
    return
  }

  await tx.insert(reconciliationResultCollections).values(
    links.map((link) => ({
      reconciliationResultId: link.reconciliationResultId,
      documentResultId: link.candidate.taxRecordId,
      batchId: link.candidate.batchId,
      uploadId: link.candidate.uploadId,
      sourceFileId: link.candidate.sourceFileId,
      taxBase: link.candidate.taxBase,
      taxWithheld: link.candidate.taxWithheld,
      appliedAt: link.appliedAt,
      createdAt: link.appliedAt,
      updatedAt: link.appliedAt,
    })),
  )
}

const refreshSalesReportRunSummaries = async (
  tx: ReconciliationCollectionTx,
  runIds: Array<string>,
  updatedAt: Date,
) => {
  for (const runId of Array.from(new Set(runIds))) {
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

export const applyProgressiveReconciliationMatchForDocument = async (input: {
  batchId: string
  documentResultId: number
  uploadId: string
  sourceFileId: string
  metadata: TaxRecordCandidate['metadata']
  taxBase: number | null
  taxWithheld: number | null
}) => {
  const db = getDb()

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
      .limit(1)

    if (alreadyLinked.length > 0) {
      return { matchedCount: 0, runIds: [] as Array<string> }
    }

    const rows = await tx
      .select({
        id: reconciliationResults.id,
        salesReportRunId: reconciliationResults.salesReportRunId,
        invoiceNumber: reconciliationResults.invoiceNumber,
        taxableSales: reconciliationResults.taxableSales,
        prepaidCWT: reconciliationResults.prepaidCWT,
        taxBase: reconciliationResults.taxBase,
        taxWithheld: reconciliationResults.taxWithheld,
        taxBaseDifference: reconciliationResults.taxBaseDifference,
        taxWithheldDifference: reconciliationResults.taxWithheldDifference,
        emailSentAt: reconciliationResults.emailSentAt,
        issuerShortnameUsedForMatch:
          reconciliationResults.issuerShortnameUsedForMatch,
        derivedBillingMonthMMYY: reconciliationResults.derivedBillingMonthMMYY,
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
            input.metadata.normalizedIssuerShortname,
          ),
          eq(
            reconciliationResults.derivedBillingMonthMMYY,
            input.metadata.billingMonthMMYY,
          ),
        ),
      )
      .orderBy(
        asc(reconciliationResults.salesReportRunId),
        asc(reconciliationResults.id),
      )

    type ActiveReconciliationMatchRow = (typeof rows)[number] & {
      salesReportRunId: string
    }
    const activeRows = rows.filter((row): row is ActiveReconciliationMatchRow =>
      Boolean(row.salesReportRunId),
    )

    if (activeRows.length === 0) {
      return { matchedCount: 0, runIds: [] as Array<string> }
    }

    const candidate: TaxRecordCandidate = {
      batchId: input.batchId,
      uploadId: input.uploadId,
      sourceFileId: input.sourceFileId,
      taxRecordId: input.documentResultId,
      fileName: '',
      uploadedAt: null,
      fileCreatedAt: new Date(0),
      resultCreatedAt: new Date(0),
      taxBase: input.taxBase,
      taxWithheld: input.taxWithheld,
      metadata: input.metadata,
    }
    const assignments = buildProgressiveReconciliationAssignments(
      activeRows.map((row) => ({
        key: String(row.id),
        rowOrder: row.id,
        issuerShortnameUsedForMatch: row.issuerShortnameUsedForMatch,
        derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
        invoiceNumber: row.invoiceNumber,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
        taxBase: row.taxBase,
        taxWithheld: row.taxWithheld,
        taxBaseDifference: row.taxBaseDifference,
        taxWithheldDifference: row.taxWithheldDifference,
      })),
      [candidate],
    )

    const assignment = assignments.at(0)
    if (!assignment) {
      return { matchedCount: 0, runIds: [] as Array<string> }
    }

    const target = activeRows.find(
      (row) => String(row.id) === assignment.rowKey,
    )
    if (!target) {
      return { matchedCount: 0, runIds: [] as Array<string> }
    }

    const matchedAt = new Date()
    await insertReconciliationCollectionLinks(tx, [
      {
        reconciliationResultId: target.id,
        candidate,
        appliedAt: matchedAt,
      },
    ])

    const shouldReopenEmail =
      Boolean(target.emailSentAt) &&
      assignment.difference.hasDifference &&
      (assignment.difference.taxBaseDifference !== target.taxBaseDifference ||
        assignment.difference.taxWithheldDifference !==
          target.taxWithheldDifference)

    await tx
      .update(reconciliationResults)
      .set({
        matchedUploadBatchId: input.batchId,
        matchedTaxRecordId: input.documentResultId,
        taxBase: assignment.aggregateTaxBase,
        taxWithheld: assignment.aggregateTaxWithheld,
        taxBaseDifference: assignment.difference.taxBaseDifference,
        taxWithheldDifference: assignment.difference.taxWithheldDifference,
        hasDifference: assignment.difference.hasDifference,
        matchStatus: 'matched',
        matchedAt,
        emailSentAt: shouldReopenEmail ? null : target.emailSentAt,
        updatedAt: matchedAt,
      })
      .where(
        and(
          eq(reconciliationResults.id, target.id),
          isNull(reconciliationResults.archivedAt),
        ),
      )

    await refreshSalesReportRunSummaries(
      tx,
      [target.salesReportRunId],
      matchedAt,
    )

    return {
      matchedCount: 1,
      runIds: [target.salesReportRunId],
    }
  })
}
