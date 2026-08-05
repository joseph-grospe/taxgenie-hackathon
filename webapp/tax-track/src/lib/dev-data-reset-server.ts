import { sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'

export const DEV_DATA_RESET_CONFIRMATION = 'CLEAR DEV DATA'

export const DEV_DATA_RESET_TABLES = [
  'reconciliation_result_collections',
  'reconciliation_results',
  'sales_report_run_batches',
  'sales_report_runs',
  'sales_report_rows',
  'sales_report_versions',
  'sales_reports',
  'certificate_merge_job_outputs',
  'certificate_merge_job_inputs',
  'certificate_merge_job_batches',
  'certificate_merge_jobs',
  'certificate_signed_artifacts',
  'certificate_override_changes',
  'certificate_override_requests',
  'result_artifacts',
  'certificate_tax_rows',
  'extracted_certificates',
  'worker_job_steps',
  'worker_jobs',
  'worker_idempotency',
  'document_extraction_attempts',
  'document_results',
  'intake_files',
  'intake_batches',
] as const

export type DevDataResetTable = (typeof DEV_DATA_RESET_TABLES)[number]
export type DevDataResetCounts = Record<DevDataResetTable, number>

type ResetRuntimeEnv = Record<string, string | undefined>

type QueryExecutor = {
  execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown>
}

const quotedResetTables = DEV_DATA_RESET_TABLES.map(
  (tableName) => `"${tableName}"`,
)

export const DEV_DATA_RESET_TRUNCATE_STATEMENT = `truncate table ${quotedResetTables.join(
  ', ',
)} restart identity cascade`

const getConfiguredStage = (env: ResetRuntimeEnv = process.env) =>
  env.TAXTRACK_APP_STAGE?.trim() || env.SST_STAGE?.trim() || ''

const getConfiguredStages = (env: ResetRuntimeEnv = process.env) =>
  [env.TAXTRACK_APP_STAGE?.trim(), env.SST_STAGE?.trim()].filter(
    (stage): stage is string => Boolean(stage),
  )

const isProdStage = (stage: string) =>
  stage === 'prod' || stage.startsWith('prod-')

const isDevStage = (stage: string) =>
  stage === 'dev' || stage.startsWith('dev-')

export const getDevDataResetStage = (
  env: ResetRuntimeEnv = process.env,
): string => {
  const stage = getConfiguredStage(env)
  if (stage) {
    return stage
  }

  return env.NODE_ENV === 'development' ? 'local-development' : 'unknown'
}

export const isDevDataResetAvailable = (env: ResetRuntimeEnv = process.env) => {
  const configuredStages = getConfiguredStages(env)

  if (configuredStages.some(isProdStage)) {
    return false
  }

  return env.NODE_ENV === 'development' || configuredStages.some(isDevStage)
}

const normalizeCount = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

const getResultRows = (result: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(result)) {
    return result.filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null,
    )
  }

  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: Array<unknown> }).rows.filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null,
    )
  }

  return []
}

const countResetTable = async (
  executor: QueryExecutor,
  tableName: DevDataResetTable,
) => {
  const result = await executor.execute(
    sql.raw(`select count(*)::int as count from "${tableName}"`),
  )
  const row = getResultRows(result).at(0)

  return row ? normalizeCount(row.count) : 0
}

const readDevDataResetCounts = async (
  executor: QueryExecutor,
): Promise<DevDataResetCounts> => {
  const entries: Array<[DevDataResetTable, number]> = []

  for (const tableName of DEV_DATA_RESET_TABLES) {
    entries.push([tableName, await countResetTable(executor, tableName)])
  }

  return Object.fromEntries(entries) as DevDataResetCounts
}

export const getDevDataResetStatus = async (
  env: ResetRuntimeEnv = process.env,
) => {
  return {
    available: isDevDataResetAvailable(env),
    stage: getDevDataResetStage(env),
    counts: await readDevDataResetCounts(getDb()),
  }
}

export const resetDevData = async (env: ResetRuntimeEnv = process.env) => {
  const stage = getDevDataResetStage(env)
  const resetAt = new Date().toISOString()
  const db = getDb()
  const deletedCounts = await db.transaction(async (tx) => {
    const counts = await readDevDataResetCounts(tx)
    await tx.execute(sql.raw(DEV_DATA_RESET_TRUNCATE_STATEMENT))

    return counts
  })

  return {
    stage,
    resetAt,
    deletedCounts,
  }
}
