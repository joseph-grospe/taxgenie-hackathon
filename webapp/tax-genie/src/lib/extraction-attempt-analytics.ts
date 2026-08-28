import { and, gte, lt } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { documentExtractionAttempts } from '@/lib/schema'

export type ExtractionAttemptAnalyticsRow = {
  status: string
  trigger: string
  providerAttemptCount: number | null
  latencyMs: number | null
  promptTokenCount: number | null
  outputTokenCount: number | null
  thoughtTokenCount: number | null
  totalTokenCount: number | null
}

export type ExtractionAttemptAnalytics = {
  executionCount: number
  initialExecutionCount: number
  manualRetryExecutionCount: number
  succeededCount: number
  failedCount: number
  processingCount: number
  providerHttpAttemptCount: number
  totalLatencyMs: number
  averageLatencyMs: number | null
  promptTokenCount: number
  outputTokenCount: number
  thoughtTokenCount: number
  totalTokenCount: number
}

const sum = (
  rows: Array<ExtractionAttemptAnalyticsRow>,
  select: (row: ExtractionAttemptAnalyticsRow) => number | null,
) => rows.reduce((total, row) => total + (select(row) ?? 0), 0)

export const summarizeExtractionAttempts = (
  rows: Array<ExtractionAttemptAnalyticsRow>,
): ExtractionAttemptAnalytics => {
  const completedLatencyRows = rows.filter((row) => row.latencyMs !== null)
  const totalLatencyMs = sum(completedLatencyRows, (row) => row.latencyMs)

  return {
    executionCount: rows.length,
    initialExecutionCount: rows.filter((row) => row.trigger === 'initial')
      .length,
    manualRetryExecutionCount: rows.filter(
      (row) => row.trigger === 'manual_retry',
    ).length,
    succeededCount: rows.filter((row) => row.status === 'succeeded').length,
    failedCount: rows.filter((row) => row.status === 'failed').length,
    processingCount: rows.filter((row) => row.status === 'processing').length,
    providerHttpAttemptCount: sum(rows, (row) => row.providerAttemptCount),
    totalLatencyMs,
    averageLatencyMs:
      completedLatencyRows.length > 0
        ? totalLatencyMs / completedLatencyRows.length
        : null,
    promptTokenCount: sum(rows, (row) => row.promptTokenCount),
    outputTokenCount: sum(rows, (row) => row.outputTokenCount),
    thoughtTokenCount: sum(rows, (row) => row.thoughtTokenCount),
    totalTokenCount: sum(rows, (row) => row.totalTokenCount),
  }
}

export const getExtractionAttemptAnalytics = async (input: {
  start: Date
  end: Date
}): Promise<ExtractionAttemptAnalytics> => {
  const rows = await getDb()
    .select({
      status: documentExtractionAttempts.status,
      trigger: documentExtractionAttempts.trigger,
      providerAttemptCount: documentExtractionAttempts.providerAttemptCount,
      latencyMs: documentExtractionAttempts.latencyMs,
      promptTokenCount: documentExtractionAttempts.promptTokenCount,
      outputTokenCount: documentExtractionAttempts.outputTokenCount,
      thoughtTokenCount: documentExtractionAttempts.thoughtTokenCount,
      totalTokenCount: documentExtractionAttempts.totalTokenCount,
    })
    .from(documentExtractionAttempts)
    .where(
      and(
        gte(documentExtractionAttempts.startedAt, input.start),
        lt(documentExtractionAttempts.startedAt, input.end),
      ),
    )

  return summarizeExtractionAttempts(rows)
}
