import {
  MERGE_TOTAL_SIZE_LIMIT_BYTES,
  assertMinimumCertificateMergeInputCount,
  buildCertificateMergeFileName,
  buildEntityStorageKey,
  buildMergeOutputKey,
  normalizeTin9,
  partitionCertificateMergeInputs,
  sortCertificateMergeInputsByPayorName,
} from '@taxgenie/shared'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import type { CertificateMergePeriod } from '@taxgenie/shared'
import type {
  CertificateMergeAssignmentStatus,
  CertificateMergePackageType,
} from '@/lib/certificate-merge-assignment'

import {
  deriveCertificateAnnualPeriod,
  deriveCertificateQuarterPeriod,
  formatAssignmentPeriodLabel,
  resolveAnnualAssignment,
  resolveQuarterlyAssignment,
  toAnnualPeriodKey,
  toQuarterPeriodKey,
} from '@/lib/certificate-merge-assignment'
import {
  getGcpRegion,
  getObjectStorage,
  getStorageBucketName,
  getStoragePrefix,
} from '@/lib/cloud-server'
import { requireFeature } from '@/lib/feature-flags-server'
import {
  logBatchStageTimingError,
  recordBatchStageTimings,
} from '@/lib/batch-stage-timing-server'
import { getDb } from '@/lib/db'
import {
  certificateMergeAssignments,
  certificateMergeJobBatches,
  certificateMergeJobInputs,
  certificateMergeJobOutputs,
  certificateMergeJobs,
  certificateResults,
  certificateSignedArtifacts,
  entities,
  intakeBatches,
  intakeFiles,
} from '@/lib/schema'

const DOWNLOAD_EXPIRY_SECONDS = 60 * 15
const RECENT_MERGE_JOB_LIMIT = 5
const DEFAULT_MERGE_JOB_PAGE_SIZE = 25
const MAX_MERGE_JOB_PAGE_SIZE = 50
const MAX_SELECTED_BATCHES = 100
const ACTIVE_MERGE_JOB_STATUSES = ['pending', 'submitted', 'running']
const DUPLICATE_BLOCKING_MERGE_JOB_STATUSES = [
  ...ACTIVE_MERGE_JOB_STATUSES,
  'succeeded',
]
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

const mergePeriodTypeSchema = z.enum(['annual', 'quarterly'])

const certificateMergePeriodScopeSchema = z.object({
  payeeShortName: z.string().trim().min(1),
  periodType: mergePeriodTypeSchema,
  year: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4).optional(),
})

const validateMergePeriodScope = (
  value: z.infer<typeof certificateMergePeriodScopeSchema>,
  ctx: z.RefinementCtx,
) => {
  if (value.periodType === 'quarterly' && value.quarter === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['quarter'],
      message: 'Quarter is required for quarterly merge jobs.',
    })
  }

  if (value.periodType === 'annual' && value.quarter !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['quarter'],
      message: 'Quarter must be omitted for annual merge jobs.',
    })
  }
}

export const certificateMergeOptionsScopeSchema =
  certificateMergePeriodScopeSchema.superRefine(validateMergePeriodScope)

const certificateMergeBatchIdsSchema = z
  .array(z.string().uuid())
  .min(1, 'Select at least one upload batch.')
  .max(
    MAX_SELECTED_BATCHES,
    `Select ${MAX_SELECTED_BATCHES} upload batches or fewer.`,
  )
  .superRefine((batchIds, ctx) => {
    if (new Set(batchIds).size !== batchIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Selected upload batches must be unique.',
      })
    }
  })

export const certificateMergeRequestSchema = certificateMergePeriodScopeSchema
  .extend({
    batchIds: certificateMergeBatchIdsSchema,
  })
  .superRefine(validateMergePeriodScope)

export type CertificateMergeRequest = z.infer<
  typeof certificateMergeRequestSchema
>
export type CertificateMergeOptionsScope = z.infer<
  typeof certificateMergeOptionsScopeSchema
>

export const certificateMergeAssignmentOverrideSchema = z
  .object({
    packageType: mergePeriodTypeSchema,
    status: z.enum(['assigned', 'manual_review']),
    assignedYear: z.number().int().min(2000).max(2100).nullable().optional(),
    assignedQuarter: z.number().int().min(1).max(4).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'manual_review') return

    if (value.assignedYear === null || value.assignedYear === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['assignedYear'],
        message: 'Assigned year is required.',
      })
    }

    if (
      value.packageType === 'quarterly' &&
      (value.assignedQuarter === null || value.assignedQuarter === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['assignedQuarter'],
        message: 'Assigned quarter is required for quarterly assignments.',
      })
    }

    if (
      value.packageType === 'annual' &&
      value.assignedQuarter !== null &&
      value.assignedQuarter !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['assignedQuarter'],
        message: 'Assigned quarter must be omitted for annual assignments.',
      })
    }
  })

export type CertificateMergeAssignmentOverrideRequest = z.infer<
  typeof certificateMergeAssignmentOverrideSchema
>

type MergeJobRecord = typeof certificateMergeJobs.$inferSelect
type MergeOutputRecord = typeof certificateMergeJobOutputs.$inferSelect
type MergeInputRecord = typeof certificateMergeJobInputs.$inferSelect
type MergeAssignmentRecord = typeof certificateMergeAssignments.$inferSelect
type CountRow = { value: number | string | bigint | null }

export type CertificateMergeJobListView = 'recent' | 'all'

type SignedMergeCandidate = {
  batchId: string
  batchName: string | null
  batchStatus: string
  batchClosedAt: Date | null
  batchLastActivityAt: Date
  batchCreatedAt: Date
  certificateId: number
  mergeAssignmentId: string
  signedArtifactId: string
  signedPdfKey: string
  originalFileName: string | null
  payorName: string | null
  payorTin: string | null
  payeeTin: string | null
  periodEnd: string | null
  createdAt: Date
  assignmentPackageType: string
  sourceYear: number
  sourceQuarter: number | null
  assignedYear: number | null
  assignedQuarter: number | null
  isLate: boolean
  assignmentReason: string
}

type SizedSignedMergeCandidate = SignedMergeCandidate & {
  id: string
  sizeBytes: number
}

export const shouldSkipMergeProviderSubmission = () =>
  !TRUE_ENV_VALUES.has(
    process.env.TAXGENIE_ENABLE_MERGE?.trim().toLowerCase() ?? '',
  )

const toIsoString = (value: Date | null | undefined) =>
  value?.toISOString() ?? null

const readCount = (rows: Array<CountRow>) => Number(rows.at(0)?.value ?? 0)

const uniqueBatchIds = (batchIds: Array<string>) =>
  Array.from(new Set(batchIds))

const toMergePeriod = (
  input: CertificateMergeRequest | CertificateMergeOptionsScope,
): CertificateMergePeriod =>
  input.periodType === 'annual'
    ? {
        type: 'annual',
        year: input.year,
      }
    : {
        type: 'quarterly',
        year: input.year,
        quarter: input.quarter as 1 | 2 | 3 | 4,
      }

const formatDuplicateMergePeriodLabel = (input: CertificateMergeRequest) =>
  input.periodType === 'annual'
    ? `TY ${input.year}`
    : `${input.quarter}Q ${input.year}`

const duplicateMergeStatusLabel = (status: string) => {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'submitted':
    case 'running':
      return 'processing'
    case 'succeeded':
      return 'completed'
    default:
      return status
  }
}

const assertNoExistingMergeJobForPeriod = async (
  input: CertificateMergeRequest,
  entityTin: string,
) => {
  const normalizedTin = normalizeTin9(entityTin)
  const quarterCondition =
    input.periodType === 'quarterly'
      ? eq(certificateMergeJobs.quarter, input.quarter as number)
      : isNull(certificateMergeJobs.quarter)

  const rows = await getDb()
    .select({
      id: certificateMergeJobs.id,
      status: certificateMergeJobs.status,
      createdAt: certificateMergeJobs.createdAt,
    })
    .from(certificateMergeJobs)
    .where(
      and(
        eq(certificateMergeJobs.entityTin, normalizedTin),
        eq(certificateMergeJobs.periodType, input.periodType),
        eq(certificateMergeJobs.year, input.year),
        quarterCondition,
        inArray(
          certificateMergeJobs.status,
          DUPLICATE_BLOCKING_MERGE_JOB_STATUSES,
        ),
      ),
    )
    .orderBy(desc(certificateMergeJobs.createdAt))
    .limit(1)

  const existingJob = rows.at(0)
  if (!existingJob) {
    return
  }

  throw new Error(
    `A merge job already exists for ${input.payeeShortName} ${formatDuplicateMergePeriodLabel(input)} (${duplicateMergeStatusLabel(existingJob.status)}). Use the existing job instead of creating a duplicate.`,
  )
}

const requireEntity = async (payeeShortName: string) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(entities)
    .where(
      sql`lower(coalesce(${entities.shortName}, '')) = ${payeeShortName.toLowerCase()}`,
    )
    .orderBy(asc(entities.id))
    .limit(1)
  const entity = rows.at(0) ?? null

  if (!entity?.shortName?.trim()) {
    throw new Error('Selected entity was not found.')
  }

  if (!entity.tin?.trim()) {
    throw new Error('Selected entity does not have a TIN.')
  }

  normalizeTin9(entity.tin)

  return {
    id: entity.id,
    shortName: entity.shortName,
    companyName: entity.companyName,
    tin: entity.tin,
  }
}

type RequiredMergeEntity = Awaited<ReturnType<typeof requireEntity>>

const isBatchForEntity = (
  batch: Pick<
    typeof intakeBatches.$inferSelect,
    'entityId' | 'entityShortName'
  >,
  entity: RequiredMergeEntity,
) => {
  if (batch.entityId !== null) {
    return batch.entityId === entity.id
  }

  return (
    batch.entityShortName?.trim().toLowerCase() ===
    entity.shortName.trim().toLowerCase()
  )
}

const normalizePackageType = (
  value: string,
): CertificateMergePackageType | null =>
  value === 'annual' || value === 'quarterly' ? value : null

const getPackagePeriodKey = (input: {
  packageType: CertificateMergePackageType
  year: number
  quarter: number | null
}) => {
  if (input.packageType === 'annual') {
    return toAnnualPeriodKey({ year: input.year })
  }

  if (
    input.quarter !== 1 &&
    input.quarter !== 2 &&
    input.quarter !== 3 &&
    input.quarter !== 4
  ) {
    return null
  }

  return toQuarterPeriodKey({
    year: input.year,
    quarter: input.quarter,
  })
}

const getUnavailableMergePeriodSets = async (input: {
  entityTin: string
  packageType: CertificateMergePackageType
}) => {
  const rows = await getDb()
    .select({
      year: certificateMergeJobs.year,
      quarter: certificateMergeJobs.quarter,
      status: certificateMergeJobs.status,
    })
    .from(certificateMergeJobs)
    .where(
      and(
        eq(certificateMergeJobs.entityTin, normalizeTin9(input.entityTin)),
        eq(certificateMergeJobs.periodType, input.packageType),
        inArray(
          certificateMergeJobs.status,
          DUPLICATE_BLOCKING_MERGE_JOB_STATUSES,
        ),
      ),
    )

  const unavailable = new Set<string>()
  const finalized = new Set<string>()

  for (const row of rows) {
    const key = getPackagePeriodKey({
      packageType: input.packageType,
      year: row.year,
      quarter: row.quarter,
    })
    if (!key) continue

    unavailable.add(key)
    if (row.status === 'succeeded') {
      finalized.add(key)
    }
  }

  return { unavailable, finalized }
}

const buildInitialAssignment = (
  input: {
    certificateId: number
    periodEnd: string | null
    packageType: CertificateMergePackageType
  },
  periodSets: Awaited<ReturnType<typeof getUnavailableMergePeriodSets>>,
): typeof certificateMergeAssignments.$inferInsert | null => {
  if (input.packageType === 'quarterly') {
    const source = deriveCertificateQuarterPeriod(input.periodEnd)
    if (!source) return null

    const decision = resolveQuarterlyAssignment(
      source,
      periodSets.unavailable,
      periodSets.finalized,
    )

    return {
      certificateId: input.certificateId,
      packageType: input.packageType,
      sourceYear: source.year,
      sourceQuarter: source.quarter,
      assignedYear: decision.assignedYear,
      assignedQuarter: decision.assignedQuarter,
      status: decision.status,
      isLate: decision.isLate,
      reason: decision.reason,
    }
  }

  const source = deriveCertificateAnnualPeriod(input.periodEnd)
  if (!source) return null

  const decision = resolveAnnualAssignment(
    source,
    periodSets.unavailable,
    periodSets.finalized,
  )

  return {
    certificateId: input.certificateId,
    packageType: input.packageType,
    sourceYear: source.year,
    sourceQuarter: null,
    assignedYear: decision.assignedYear,
    assignedQuarter: decision.assignedQuarter,
    status: decision.status,
    isLate: decision.isLate,
    reason: decision.reason,
  }
}

const ensureMissingMergeAssignments = async (input: {
  payeeShortName: string
  entityTin: string
  packageType: CertificateMergePackageType
}) => {
  const db = getDb()
  const rows = await db
    .select({
      certificateId: certificateResults.id,
      periodEnd: certificateResults.periodEnd,
    })
    .from(certificateResults)
    .innerJoin(intakeBatches, eq(intakeBatches.id, certificateResults.batchId))
    .innerJoin(intakeFiles, eq(intakeFiles.id, certificateResults.uploadId))
    .leftJoin(
      certificateMergeAssignments,
      and(
        eq(certificateMergeAssignments.certificateId, certificateResults.id),
        eq(certificateMergeAssignments.packageType, input.packageType),
      ),
    )
    .where(
      and(
        eq(certificateResults.status, 'accepted'),
        isNull(intakeBatches.deletedAt),
        isNull(intakeFiles.removedFromBatchAt),
        isNull(intakeFiles.purgeStatus),
        sql`lower(coalesce(${certificateResults.payeeShortName}, '')) = ${input.payeeShortName.toLowerCase()}`,
        isNotNull(certificateResults.periodEnd),
        isNull(certificateMergeAssignments.id),
      ),
    )

  if (rows.length === 0) return

  const periodSets = await getUnavailableMergePeriodSets({
    entityTin: input.entityTin,
    packageType: input.packageType,
  })
  const values = rows.flatMap((row) => {
    const assignment = buildInitialAssignment(
      {
        certificateId: row.certificateId,
        periodEnd: row.periodEnd,
        packageType: input.packageType,
      },
      periodSets,
    )

    return assignment ? [assignment] : []
  })

  if (values.length === 0) return

  await db
    .insert(certificateMergeAssignments)
    .values(values)
    .onConflictDoNothing()
}

const getSignedMergeCandidates = async (
  input: CertificateMergeRequest | CertificateMergeOptionsScope,
  entityTin: string,
  options: { batchIds?: Array<string> } = {},
): Promise<Array<SignedMergeCandidate>> => {
  const db = getDb()
  const packageType = normalizePackageType(input.periodType)
  if (!packageType) return []
  const scopedBatchIds = uniqueBatchIds(options.batchIds ?? [])
  const batchCondition =
    scopedBatchIds.length > 0
      ? inArray(certificateResults.batchId, scopedBatchIds)
      : sql`true`

  await ensureMissingMergeAssignments({
    payeeShortName: input.payeeShortName,
    entityTin,
    packageType,
  })

  const assignedPeriodCondition =
    packageType === 'quarterly'
      ? and(
          eq(certificateMergeAssignments.assignedYear, input.year),
          eq(certificateMergeAssignments.assignedQuarter, input.quarter!),
        )
      : and(
          eq(certificateMergeAssignments.assignedYear, input.year),
          isNull(certificateMergeAssignments.assignedQuarter),
        )

  return db
    .select({
      batchId: certificateResults.batchId,
      batchName: intakeBatches.name,
      batchStatus: intakeBatches.status,
      batchClosedAt: intakeBatches.closedAt,
      batchLastActivityAt: intakeBatches.lastActivityAt,
      batchCreatedAt: intakeBatches.createdAt,
      certificateId: certificateResults.id,
      mergeAssignmentId: certificateMergeAssignments.id,
      signedArtifactId: certificateSignedArtifacts.id,
      signedPdfKey: certificateSignedArtifacts.signedPdfKey,
      originalFileName: certificateResults.originalFileName,
      payorName: certificateResults.payorName,
      payorTin: certificateResults.payorTin,
      payeeTin: certificateResults.payeeTin,
      periodEnd: certificateResults.periodEnd,
      createdAt: certificateResults.createdAt,
      assignmentPackageType: certificateMergeAssignments.packageType,
      sourceYear: certificateMergeAssignments.sourceYear,
      sourceQuarter: certificateMergeAssignments.sourceQuarter,
      assignedYear: certificateMergeAssignments.assignedYear,
      assignedQuarter: certificateMergeAssignments.assignedQuarter,
      isLate: certificateMergeAssignments.isLate,
      assignmentReason: certificateMergeAssignments.reason,
    })
    .from(certificateResults)
    .innerJoin(intakeBatches, eq(intakeBatches.id, certificateResults.batchId))
    .innerJoin(intakeFiles, eq(intakeFiles.id, certificateResults.uploadId))
    .innerJoin(
      certificateSignedArtifacts,
      eq(certificateSignedArtifacts.certificateId, certificateResults.id),
    )
    .innerJoin(
      certificateMergeAssignments,
      and(
        eq(certificateMergeAssignments.certificateId, certificateResults.id),
        eq(certificateMergeAssignments.packageType, packageType),
      ),
    )
    .where(
      and(
        eq(certificateResults.status, 'accepted'),
        isNull(intakeBatches.deletedAt),
        isNull(intakeFiles.removedFromBatchAt),
        isNull(intakeFiles.purgeStatus),
        eq(intakeBatches.status, 'closed'),
        batchCondition,
        sql`lower(coalesce(${certificateResults.payeeShortName}, '')) = ${input.payeeShortName.toLowerCase()}`,
        assignedPeriodCondition,
        eq(certificateMergeAssignments.status, 'assigned'),
        eq(certificateSignedArtifacts.status, 'signed'),
        isNotNull(certificateSignedArtifacts.signedPdfKey),
      ),
    )
    .orderBy(asc(certificateResults.id))
    .then((rows) =>
      sortCertificateMergeInputsByPayorName(
        rows.flatMap((row) =>
          row.signedPdfKey
            ? [
                {
                  ...row,
                  signedPdfKey: row.signedPdfKey,
                },
              ]
            : [],
        ),
      ),
    )
}

const requireSelectedMergeBatches = async (
  input: CertificateMergeRequest,
  entity: RequiredMergeEntity,
) => {
  const batchIds = uniqueBatchIds(input.batchIds)
  const rows = await getDb()
    .select()
    .from(intakeBatches)
    .where(
      and(inArray(intakeBatches.id, batchIds), isNull(intakeBatches.deletedAt)),
    )

  if (rows.length !== batchIds.length) {
    throw new Error('One or more selected upload batches were not found.')
  }

  const byId = new Map(rows.map((batch) => [batch.id, batch]))
  const orderedBatches = batchIds.flatMap((batchId) => {
    const batch = byId.get(batchId)
    return batch ? [batch] : []
  })

  for (const batch of orderedBatches) {
    if (batch.status !== 'closed') {
      throw new Error('Only closed upload batches can be merged.')
    }

    if (!isBatchForEntity(batch, entity)) {
      throw new Error(
        'All selected upload batches must belong to the selected entity.',
      )
    }
  }

  return orderedBatches
}

const assertSelectedBatchesContributeCandidates = (
  selectedBatches: Array<typeof intakeBatches.$inferSelect>,
  candidates: Array<SignedMergeCandidate>,
) => {
  const candidateBatchIds = new Set(
    candidates.map((candidate) => candidate.batchId),
  )
  const missingBatch = selectedBatches.find(
    (batch) => !candidateBatchIds.has(batch.id),
  )

  if (missingBatch) {
    throw new Error(
      'Every selected upload batch must contain at least one signed 2307 PDF eligible for this merge period.',
    )
  }
}

const getValidatedSignedMergeCandidates = async (
  input: CertificateMergeRequest,
  entity: RequiredMergeEntity,
) => {
  const selectedBatches = await requireSelectedMergeBatches(input, entity)
  const candidates = await getSignedMergeCandidates(input, entity.tin, {
    batchIds: selectedBatches.map((batch) => batch.id),
  })

  assertSelectedBatchesContributeCandidates(selectedBatches, candidates)

  return {
    candidates,
    selectedBatches,
  }
}

const getSignedObjectSizes = async (
  candidates: Array<SignedMergeCandidate>,
): Promise<Array<SizedSignedMergeCandidate>> => {
  const bucket = getStorageBucketName()
  const storage = getObjectStorage()

  return Promise.all(
    candidates.map(async (candidate) => {
      const metadata = await storage.getMetadata({
        bucket,
        key: candidate.signedPdfKey,
      })
      const sizeBytes = metadata.size

      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new Error(
          `Signed PDF is missing or empty: ${candidate.signedPdfKey}`,
        )
      }

      return {
        ...candidate,
        id: String(candidate.certificateId),
        sizeBytes,
      }
    }),
  )
}

const buildPreviewFromSizedCandidates = (
  input: CertificateMergeRequest,
  entityTin: string,
  candidates: Array<SizedSignedMergeCandidate>,
) => {
  const totalSizeBytes = candidates.reduce(
    (total, candidate) => total + candidate.sizeBytes,
    0,
  )

  if (totalSizeBytes > MERGE_TOTAL_SIZE_LIMIT_BYTES) {
    throw new Error(
      'Selected signed PDFs exceed the three-file merge limit of 14.4 GB.',
    )
  }

  const period = toMergePeriod(input)
  const parts = partitionCertificateMergeInputs(candidates).map((part) => {
    const fileName = buildCertificateMergeFileName(
      entityTin,
      period,
      part.partNumber,
    )

    return {
      partNumber: part.partNumber,
      fileName,
      outputKey: '',
      sizeBytes: part.sizeBytes,
      inputCount: part.inputs.length,
      inputIds: part.inputs.map((item) => item.certificateId),
    }
  })

  return {
    payeeShortName: input.payeeShortName,
    periodType: input.periodType,
    year: input.year,
    quarter: input.periodType === 'quarterly' ? input.quarter : null,
    totalInputFiles: candidates.length,
    totalSizeBytes,
    outputCount: parts.length,
    lateInputCount: candidates.filter((candidate) => candidate.isLate).length,
    candidateRows: candidates.map((candidate) => ({
      certificateId: candidate.certificateId,
      fileName:
        candidate.originalFileName ?? `Document ${candidate.certificateId}`,
      certificatePeriod: formatAssignmentPeriodLabel({
        packageType:
          candidate.assignmentPackageType === 'annual' ? 'annual' : 'quarterly',
        year: candidate.sourceYear,
        quarter: candidate.sourceQuarter,
      }),
      assignedPeriod: formatAssignmentPeriodLabel({
        packageType: input.periodType,
        year: candidate.assignedYear,
        quarter: candidate.assignedQuarter,
      }),
      isLate: candidate.isLate,
      assignmentReason: candidate.assignmentReason,
    })),
    parts,
  }
}

export const listCertificateMergeEntities = async () => {
  const db = getDb()
  const rows = await db
    .select({
      id: entities.id,
      shortName: entities.shortName,
      companyName: entities.companyName,
      tin: entities.tin,
    })
    .from(entities)
    .where(sql`coalesce(trim(${entities.shortName}), '') <> ''`)
    .orderBy(asc(entities.shortName), asc(entities.id))

  return rows.map((row) => {
    let hasValidTin = false
    try {
      if (row.tin) {
        normalizeTin9(row.tin)
        hasValidTin = true
      }
    } catch {
      hasValidTin = false
    }

    return {
      id: row.id,
      shortName: row.shortName ?? '',
      companyName: row.companyName,
      tin: row.tin,
      hasValidTin,
    }
  })
}

export const listCertificateMergeBatchOptions = async (
  input: CertificateMergeOptionsScope,
) => {
  const parsed = certificateMergeOptionsScopeSchema.parse(input)
  const entity = await requireEntity(parsed.payeeShortName)
  const candidates = await getSignedMergeCandidates(parsed, entity.tin)
  const optionByBatchId = new Map<
    string,
    {
      id: string
      name: string | null
      status: string
      closedAt: string | null
      lastActivityAt: string | null
      createdAt: string | null
      eligibleSignedPdfCount: number
    }
  >()

  for (const candidate of candidates) {
    const current = optionByBatchId.get(candidate.batchId)
    if (current) {
      current.eligibleSignedPdfCount += 1
      continue
    }

    optionByBatchId.set(candidate.batchId, {
      id: candidate.batchId,
      name: candidate.batchName,
      status: candidate.batchStatus,
      closedAt: toIsoString(candidate.batchClosedAt),
      lastActivityAt: toIsoString(candidate.batchLastActivityAt),
      createdAt: toIsoString(candidate.batchCreatedAt),
      eligibleSignedPdfCount: 1,
    })
  }

  return Array.from(optionByBatchId.values()).sort((left, right) => {
    const leftTime = Date.parse(left.closedAt ?? left.lastActivityAt ?? '')
    const rightTime = Date.parse(right.closedAt ?? right.lastActivityAt ?? '')
    const timeCompare =
      (Number.isNaN(rightTime) ? 0 : rightTime) -
      (Number.isNaN(leftTime) ? 0 : leftTime)

    if (timeCompare !== 0) return timeCompare
    return left.id.localeCompare(right.id)
  })
}

export const previewCertificateMergeJob = async (
  input: CertificateMergeRequest,
) => {
  requireFeature('merge')
  const parsed = certificateMergeRequestSchema.parse(input)
  const entity = await requireEntity(parsed.payeeShortName)
  await assertNoExistingMergeJobForPeriod(parsed, entity.tin)
  const { candidates } = await getValidatedSignedMergeCandidates(parsed, entity)

  if (candidates.length === 0) {
    throw new Error(
      'No signed 2307 PDFs were found for this entity and period.',
    )
  }

  const sizedCandidates = await getSignedObjectSizes(candidates)
  return buildPreviewFromSizedCandidates(parsed, entity.tin, sizedCandidates)
}

const submitMergeProviderJob = async (mergeJobId: string) => {
  void mergeJobId
  requireFeature('merge')
  throw new Error('No merge provider is configured.')
}

const getMergeJobBatchIds = async (mergeJobId: string, partNumber?: number) => {
  const rows = await getDb()
    .select({ batchId: certificateResults.batchId })
    .from(certificateMergeJobInputs)
    .innerJoin(
      certificateResults,
      eq(certificateResults.id, certificateMergeJobInputs.certificateId),
    )
    .where(
      partNumber === undefined
        ? eq(certificateMergeJobInputs.mergeJobId, mergeJobId)
        : and(
            eq(certificateMergeJobInputs.mergeJobId, mergeJobId),
            eq(certificateMergeJobInputs.outputPartNumber, partNumber),
          ),
    )

  return Array.from(new Set(rows.map((row) => row.batchId)))
}

const recordMergeTimingForJob = async (job: MergeJobRecord) => {
  if (job.status !== 'succeeded' || !job.startedAt || !job.finishedAt) return

  const batchIds = await getMergeJobBatchIds(job.id)
  await recordBatchStageTimings(
    batchIds.map((batchId) => ({
      batchId,
      stage: 'merge',
      startedAt: job.startedAt!,
      finishedAt: job.finishedAt!,
      dedupeKey: `merge:${job.id}:${batchId}`,
      sourceType: 'merge_job',
      sourceId: job.id,
      metadata: {
        totalInputFiles: job.totalInputFiles,
        outputCount: job.outputCount,
      },
    })),
  )
}

export const createCertificateMergeJob = async (input: {
  request: CertificateMergeRequest
  userId: string
}) => {
  requireFeature('merge')
  const parsed = certificateMergeRequestSchema.parse(input.request)
  const entity = await requireEntity(parsed.payeeShortName)
  await assertNoExistingMergeJobForPeriod(parsed, entity.tin)
  const { candidates: mergeCandidates, selectedBatches } =
    await getValidatedSignedMergeCandidates(parsed, entity)
  assertMinimumCertificateMergeInputCount(mergeCandidates.length)
  const candidates = await getSignedObjectSizes(mergeCandidates)

  const preview = buildPreviewFromSizedCandidates(
    parsed,
    entity.tin,
    candidates,
  )
  const db = getDb()
  const now = new Date()

  const mergeJob = await db.transaction(async (tx) => {
    const lockedFiles = await tx
      .select({
        id: intakeFiles.id,
        purgeStatus: intakeFiles.purgeStatus,
        removedFromBatchAt: intakeFiles.removedFromBatchAt,
      })
      .from(intakeFiles)
      .innerJoin(
        certificateResults,
        eq(certificateResults.uploadId, intakeFiles.id),
      )
      .where(
        inArray(
          certificateResults.id,
          candidates.map((candidate) => candidate.certificateId),
        ),
      )
      .for('update')
    const lockedBatches = await tx
      .select({ id: intakeBatches.id, deletedAt: intakeBatches.deletedAt })
      .from(intakeBatches)
      .where(
        inArray(
          intakeBatches.id,
          selectedBatches.map((batch) => batch.id),
        ),
      )
      .for('update')

    if (
      lockedFiles.length !== candidates.length ||
      lockedFiles.some((file) => file.purgeStatus || file.removedFromBatchAt) ||
      lockedBatches.length !== selectedBatches.length ||
      lockedBatches.some((batch) => batch.deletedAt)
    ) {
      throw new Error(
        'One or more selected certificates became unavailable for merging.',
      )
    }

    const [job] = await tx
      .insert(certificateMergeJobs)
      .values({
        createdByUserId: input.userId,
        payeeShortName: parsed.payeeShortName,
        entityTin: normalizeTin9(entity.tin),
        periodType: parsed.periodType,
        year: parsed.year,
        quarter: parsed.periodType === 'quarterly' ? parsed.quarter : null,
        status: 'pending',
        totalInputFiles: preview.totalInputFiles,
        totalSizeBytes: preview.totalSizeBytes,
        outputCount: preview.outputCount,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    const partByInputId = new Map<number, number>()
    for (const part of preview.parts) {
      for (const inputId of part.inputIds) {
        partByInputId.set(inputId, part.partNumber)
      }
    }

    await tx.insert(certificateMergeJobInputs).values(
      candidates.map((candidate, index) => ({
        mergeJobId: job.id,
        certificateId: candidate.certificateId,
        signedArtifactId: candidate.signedArtifactId,
        signedPdfKey: candidate.signedPdfKey,
        sizeBytes: candidate.sizeBytes,
        inputOrder: index + 1,
        outputPartNumber: partByInputId.get(candidate.certificateId) ?? null,
        mergeAssignmentId: candidate.mergeAssignmentId,
        sourcePackageType: candidate.assignmentPackageType,
        sourceYear: candidate.sourceYear,
        sourceQuarter: candidate.sourceQuarter,
        assignedYear: candidate.assignedYear,
        assignedQuarter: candidate.assignedQuarter,
        isLate: candidate.isLate,
        assignmentReason: candidate.assignmentReason,
        originalFileName: candidate.originalFileName,
        payorName: candidate.payorName,
        payeeTin: candidate.payeeTin,
        periodEnd: candidate.periodEnd,
      })),
    )

    await tx.insert(certificateMergeJobBatches).values(
      selectedBatches.map((batch) => ({
        mergeJobId: job.id,
        batchId: batch.id,
      })),
    )

    await tx.insert(certificateMergeJobOutputs).values(
      preview.parts.map((part) => ({
        mergeJobId: job.id,
        partNumber: part.partNumber,
        fileName: part.fileName,
        outputKey: buildMergeOutputKey({
          prefix: getStoragePrefix(),
          entityKey: buildEntityStorageKey(entity),
          mergeJobId: job.id,
          partNumber: part.partNumber,
          fileName: part.fileName,
        }),
        sizeBytes: null,
        inputCount: part.inputCount,
        status: 'pending',
      })),
    )

    return job
  })

  if (shouldSkipMergeProviderSubmission()) {
    return getCertificateMergeJobView({
      mergeJobId: mergeJob.id,
      userId: input.userId,
      allowAdmin: true,
    })
  }

  try {
    const providerJobId = await submitMergeProviderJob(mergeJob.id)
    await db
      .update(certificateMergeJobs)
      .set({
        providerJobId,
        providerJobStatus: 'SUBMITTED',
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(certificateMergeJobs.id, mergeJob.id))
  } catch (error) {
    await db
      .update(certificateMergeJobs)
      .set({
        status: 'failed',
        errorMessage:
          error instanceof Error ? error.message : 'Unable to submit job.',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(certificateMergeJobs.id, mergeJob.id))
    throw error
  }

  return getCertificateMergeJobView({
    mergeJobId: mergeJob.id,
    userId: input.userId,
    allowAdmin: true,
  })
}

const assertAssignmentTargetOpen = async (input: {
  entityTin: string
  packageType: CertificateMergePackageType
  assignedYear: number
  assignedQuarter: number | null
}) => {
  const periodSets = await getUnavailableMergePeriodSets({
    entityTin: input.entityTin,
    packageType: input.packageType,
  })
  const key = getPackagePeriodKey({
    packageType: input.packageType,
    year: input.assignedYear,
    quarter: input.assignedQuarter,
  })

  if (!key || periodSets.unavailable.has(key)) {
    throw new Error('The selected merge package is already locked or active.')
  }
}

export const overrideCertificateMergeAssignment = async (input: {
  certificateId: number
  userId: string
  request: CertificateMergeAssignmentOverrideRequest
}): Promise<MergeAssignmentRecord> => {
  const parsed = certificateMergeAssignmentOverrideSchema.parse(input.request)
  const packageType = parsed.packageType as CertificateMergePackageType
  const db = getDb()
  const rows = await db
    .select()
    .from(certificateResults)
    .where(eq(certificateResults.id, input.certificateId))
    .limit(1)
  const document = rows.at(0) ?? null

  if (!document || document.status !== 'accepted') {
    throw new Error('Validated certificate was not found.')
  }

  if (!document.periodEnd) {
    throw new Error('Certificate period is missing.')
  }

  if (!document.payeeShortName) {
    throw new Error('Certificate entity is missing.')
  }

  const entity = await requireEntity(document.payeeShortName)
  const sourceQuarter = deriveCertificateQuarterPeriod(document.periodEnd)
  const sourceAnnual = deriveCertificateAnnualPeriod(document.periodEnd)
  if (!sourceQuarter || !sourceAnnual) {
    throw new Error('Certificate period is invalid.')
  }

  const normalizedStatus = parsed.status as CertificateMergeAssignmentStatus
  const assignedYear: number | null =
    normalizedStatus === 'assigned' ? (parsed.assignedYear ?? null) : null
  const assignedQuarter =
    normalizedStatus === 'assigned' && packageType === 'quarterly'
      ? (parsed.assignedQuarter ?? null)
      : null

  if (normalizedStatus === 'assigned') {
    if (assignedYear === null) {
      throw new Error('Assigned year is required.')
    }

    if (packageType === 'quarterly' && assignedQuarter === null) {
      throw new Error('Assigned quarter is required for quarterly assignments.')
    }

    await assertAssignmentTargetOpen({
      entityTin: entity.tin,
      packageType,
      assignedYear,
      assignedQuarter,
    })
  }

  const sourceYear =
    packageType === 'annual' ? sourceAnnual.year : sourceQuarter.year
  const sourceQuarterValue =
    packageType === 'annual' ? null : sourceQuarter.quarter
  const periodSets = await getUnavailableMergePeriodSets({
    entityTin: entity.tin,
    packageType,
  })
  const sourceKey =
    packageType === 'annual'
      ? toAnnualPeriodKey({ year: sourceYear })
      : toQuarterPeriodKey({
          year: sourceYear,
          quarter: sourceQuarterValue as 1 | 2 | 3 | 4,
        })
  const isLate = periodSets.finalized.has(sourceKey)
  const now = new Date()
  const values = {
    certificateId: input.certificateId,
    packageType,
    sourceYear,
    sourceQuarter: sourceQuarterValue,
    assignedYear,
    assignedQuarter,
    status: normalizedStatus,
    isLate,
    reason:
      normalizedStatus === 'manual_review'
        ? 'manual_review'
        : 'manual_override',
    assignedByUserId: input.userId,
    updatedAt: now,
  }

  const [assignment] = await db
    .insert(certificateMergeAssignments)
    .values(values)
    .onConflictDoUpdate({
      target: [
        certificateMergeAssignments.certificateId,
        certificateMergeAssignments.packageType,
      ],
      set: values,
    })
    .returning()

  return assignment
}

const syncMergeProviderStatus = async (job: MergeJobRecord) => job

const toMergeJobView = (
  job: MergeJobRecord,
  inputs: Array<MergeInputRecord>,
  outputs: Array<MergeOutputRecord>,
) => ({
  id: job.id,
  payeeShortName: job.payeeShortName,
  entityTin: job.entityTin,
  periodType: job.periodType,
  year: job.year,
  quarter: job.quarter,
  status: job.status,
  providerJobId: job.providerJobId,
  providerJobStatus: job.providerJobStatus,
  totalInputFiles: job.totalInputFiles,
  totalSizeBytes: job.totalSizeBytes,
  outputCount: job.outputCount,
  errorMessage: job.errorMessage,
  submittedAt: toIsoString(job.submittedAt),
  startedAt: toIsoString(job.startedAt),
  finishedAt: toIsoString(job.finishedAt),
  createdAt: toIsoString(job.createdAt),
  updatedAt: toIsoString(job.updatedAt),
  inputs: inputs.map((input) => ({
    id: input.id,
    certificateId: input.certificateId,
    sizeBytes: input.sizeBytes,
    inputOrder: input.inputOrder,
    outputPartNumber: input.outputPartNumber,
    mergeAssignmentId: input.mergeAssignmentId,
    sourcePackageType: input.sourcePackageType,
    sourceYear: input.sourceYear,
    sourceQuarter: input.sourceQuarter,
    assignedYear: input.assignedYear,
    assignedQuarter: input.assignedQuarter,
    isLate: input.isLate,
    assignmentReason: input.assignmentReason,
    originalFileName: input.originalFileName,
    payorName: input.payorName,
    periodEnd: input.periodEnd,
  })),
  outputs: outputs.map((output) => ({
    id: output.id,
    partNumber: output.partNumber,
    fileName: output.fileName,
    sizeBytes: output.sizeBytes,
    inputCount: output.inputCount,
    status: output.status,
    downloadReady: output.status === 'ready' && Boolean(output.outputKey),
    createdAt: toIsoString(output.createdAt),
    updatedAt: toIsoString(output.updatedAt),
  })),
})

export const getCertificateMergeJobView = async (input: {
  mergeJobId: string
  userId: string
  allowAdmin?: boolean
}) => {
  requireFeature('merge')
  const db = getDb()
  const jobs = await db
    .select()
    .from(certificateMergeJobs)
    .where(eq(certificateMergeJobs.id, input.mergeJobId))
    .limit(1)
  const job = jobs.at(0) ?? null

  if (!job) {
    return null
  }

  if (job.createdByUserId !== input.userId && !input.allowAdmin) {
    throw new Error('You do not have permission to view this merge job.')
  }

  const syncedJob = await syncMergeProviderStatus(job)
  const [inputs, outputs] = await Promise.all([
    db
      .select()
      .from(certificateMergeJobInputs)
      .where(eq(certificateMergeJobInputs.mergeJobId, job.id))
      .orderBy(asc(certificateMergeJobInputs.inputOrder)),
    db
      .select()
      .from(certificateMergeJobOutputs)
      .where(eq(certificateMergeJobOutputs.mergeJobId, job.id))
      .orderBy(asc(certificateMergeJobOutputs.partNumber)),
  ])

  return toMergeJobView(syncedJob, inputs, outputs)
}

export const listCertificateMergeJobs = async (input: {
  userId: string
  allowAdmin?: boolean
  view?: CertificateMergeJobListView
  page?: number
  pageSize?: number
}) => {
  const db = getDb()
  const accessCondition = input.allowAdmin
    ? sql`true`
    : eq(certificateMergeJobs.createdByUserId, input.userId)
  const view = input.view ?? 'recent'
  const page = Math.max(1, input.page ?? 1)
  const pageSize =
    view === 'all'
      ? Math.min(
          MAX_MERGE_JOB_PAGE_SIZE,
          Math.max(1, input.pageSize ?? DEFAULT_MERGE_JOB_PAGE_SIZE),
        )
      : RECENT_MERGE_JOB_LIMIT
  const offset = view === 'all' ? (page - 1) * pageSize : 0

  const [totalRows, activeRows, readyRows, jobs] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(certificateMergeJobs)
      .where(accessCondition),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(certificateMergeJobs)
      .where(
        and(
          accessCondition,
          inArray(certificateMergeJobs.status, ACTIVE_MERGE_JOB_STATUSES),
        ),
      ),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(certificateMergeJobOutputs)
      .innerJoin(
        certificateMergeJobs,
        eq(certificateMergeJobOutputs.mergeJobId, certificateMergeJobs.id),
      )
      .where(
        and(accessCondition, eq(certificateMergeJobOutputs.status, 'ready')),
      ),
    db
      .select()
      .from(certificateMergeJobs)
      .where(accessCondition)
      .orderBy(desc(certificateMergeJobs.createdAt))
      .limit(pageSize)
      .offset(offset),
  ])
  const totalJobs = readCount(totalRows)
  const summary = {
    totalJobs,
    activeJobs: readCount(activeRows),
    readyDownloads: readCount(readyRows),
  }

  if (jobs.length === 0) {
    return {
      jobs: [],
      summary,
      ...(view === 'all'
        ? {
            pagination: {
              page,
              pageSize,
              totalItems: totalJobs,
              totalPages: Math.max(1, Math.ceil(totalJobs / pageSize)),
              hasNextPage: page * pageSize < totalJobs,
              hasPreviousPage: page > 1,
            },
          }
        : {}),
    }
  }

  const syncedJobs = await Promise.all(
    jobs.map((job) => syncMergeProviderStatus(job)),
  )
  const jobIds = syncedJobs.map((job) => job.id)
  const outputs = await db
    .select()
    .from(certificateMergeJobOutputs)
    .where(inArray(certificateMergeJobOutputs.mergeJobId, jobIds))
    .orderBy(asc(certificateMergeJobOutputs.partNumber))
  const outputsByJobId = new Map<string, Array<MergeOutputRecord>>()

  for (const output of outputs) {
    const current = outputsByJobId.get(output.mergeJobId) ?? []
    current.push(output)
    outputsByJobId.set(output.mergeJobId, current)
  }

  return {
    jobs: syncedJobs.map((job) =>
      toMergeJobView(job, [], outputsByJobId.get(job.id) ?? []),
    ),
    summary,
    ...(view === 'all'
      ? {
          pagination: {
            page,
            pageSize,
            totalItems: totalJobs,
            totalPages: Math.max(1, Math.ceil(totalJobs / pageSize)),
            hasNextPage: page * pageSize < totalJobs,
            hasPreviousPage: page > 1,
          },
        }
      : {}),
  }
}

export const getCertificateMergeOutputDownload = async (input: {
  mergeJobId: string
  partNumber: number
  userId: string
  allowAdmin?: boolean
}) => {
  const downloadStartedAt = new Date()
  const db = getDb()
  const jobs = await db
    .select()
    .from(certificateMergeJobs)
    .where(eq(certificateMergeJobs.id, input.mergeJobId))
    .limit(1)
  const job = jobs.at(0) ?? null

  if (!job) {
    throw new Error('Merge job not found.')
  }

  if (job.createdByUserId !== input.userId && !input.allowAdmin) {
    throw new Error('You do not have permission to download this merge output.')
  }
  await recordMergeTimingForJob(job).catch(logBatchStageTimingError)

  const outputs = await db
    .select()
    .from(certificateMergeJobOutputs)
    .where(
      and(
        eq(certificateMergeJobOutputs.mergeJobId, input.mergeJobId),
        eq(certificateMergeJobOutputs.partNumber, input.partNumber),
      ),
    )
    .limit(1)
  const output = outputs.at(0) ?? null

  if (!output || output.status !== 'ready' || !output.outputKey) {
    throw new Error('Merged PDF output is not ready.')
  }
  const isFirstDownload = output.firstDownloadedAt === null

  const bucket = getStorageBucketName()
  const url = await getObjectStorage().createSignedDownloadUrl({
    bucket,
    key: output.outputKey,
    expiresInSeconds: DOWNLOAD_EXPIRY_SECONDS,
  })
  const downloadedAt = new Date()

  await db
    .update(certificateMergeJobOutputs)
    .set({
      firstDownloadedAt: sql`coalesce(${certificateMergeJobOutputs.firstDownloadedAt}, ${downloadedAt})`,
      lastDownloadedAt: downloadedAt,
      downloadCount: sql`${certificateMergeJobOutputs.downloadCount} + 1`,
      firstDownloadedByUserId: sql`coalesce(${certificateMergeJobOutputs.firstDownloadedByUserId}, ${input.userId})`,
      updatedAt: downloadedAt,
    })
    .where(eq(certificateMergeJobOutputs.id, output.id))
  const downloadFinishedAt = new Date()

  if (isFirstDownload) {
    const batchIds = await getMergeJobBatchIds(
      input.mergeJobId,
      input.partNumber,
    )
    await recordBatchStageTimings(
      batchIds.map((batchId) => ({
        batchId,
        stage: 'download',
        startedAt: downloadStartedAt,
        finishedAt: downloadFinishedAt,
        dedupeKey: `download:${output.id}:${batchId}`,
        sourceType: 'merge_output',
        sourceId: String(output.id),
        metadata: {
          mergeJobId: input.mergeJobId,
          partNumber: input.partNumber,
          fileName: output.fileName,
        },
      })),
    ).catch(logBatchStageTimingError)
  }

  return {
    url,
    expiresIn: DOWNLOAD_EXPIRY_SECONDS,
    fileName: output.fileName,
    bucket,
    region: getGcpRegion(),
  }
}
