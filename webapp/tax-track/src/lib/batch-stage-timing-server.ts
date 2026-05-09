import { batchStageTimings } from '@/lib/schema'
import { getDb } from '@/lib/db'

export const batchStageTimingStages = [
  'upload',
  'plotting',
  'reconciliation',
  'signing',
  'merge',
  'download',
] as const

export type BatchStageTimingStage = (typeof batchStageTimingStages)[number]

type BatchStageTimingInput = {
  batchId: string
  stage: BatchStageTimingStage
  startedAt: Date
  finishedAt: Date
  dedupeKey?: string
  sourceType?: string
  sourceId?: string
  metadata?: Record<string, unknown>
}

const toValidTimingRow = (input: BatchStageTimingInput) => {
  const durationMs = input.finishedAt.getTime() - input.startedAt.getTime()
  if (
    Number.isNaN(input.startedAt.getTime()) ||
    Number.isNaN(input.finishedAt.getTime()) ||
    durationMs < 0
  ) {
    return null
  }

  return {
    batchId: input.batchId,
    stage: input.stage,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs,
    dedupeKey: input.dedupeKey,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    metadata: input.metadata,
  }
}

export const recordBatchStageTimings = async (
  inputs: Array<BatchStageTimingInput>,
) => {
  const rows = inputs.flatMap((input) => {
    const row = toValidTimingRow(input)
    return row ? [row] : []
  })

  if (rows.length === 0) return

  await getDb()
    .insert(batchStageTimings)
    .values(rows)
    .onConflictDoNothing({ target: batchStageTimings.dedupeKey })
}

export const recordBatchStageTiming = async (input: BatchStageTimingInput) =>
  recordBatchStageTimings([input])

export const logBatchStageTimingError = (error: unknown) => {
  console.error('Unable to record batch stage timing.', error)
}
