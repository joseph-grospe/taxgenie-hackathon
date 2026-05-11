import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { DescribeJobsCommand, SubmitJobCommand } from '@aws-sdk/client-batch'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  MERGE_TOTAL_SIZE_LIMIT_BYTES,
  buildCertificateMergeFileName,
  buildEntityStorageKey,
  buildMergeOutputKey,
  normalizeTin9,
  partitionCertificateMergeInputs,
  sortCertificateMergeInputsByPayorName,
} from '@taxtrack/shared'
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
import type { CertificateMergePeriod } from '@taxtrack/shared'
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
  createBatchServerClient,
  createS3ServerClient,
  getAwsRegion,
  getMergeBatchJobDefinition,
  getMergeBatchJobQueue,
  getStorageBucketName,
  getStoragePrefix,
} from '@/lib/aws-server'
import {
  logBatchStageTimingError,
  recordBatchStageTimings,
} from '@/lib/batch-stage-timing-server'
import { getDb } from '@/lib/db'
import {
  certificateMergeAssignments,
  certificateMergeJobInputs,
  certificateMergeJobOutputs,
  certificateMergeJobs,
  certificateSignedArtifacts,
  documentResults,
  entities,
} from '@/lib/schema'

const DOWNLOAD_EXPIRY_SECONDS = 60 * 15
const RECENT_MERGE_JOB_LIMIT = 5
const DEFAULT_MERGE_JOB_PAGE_SIZE = 25
const MAX_MERGE_JOB_PAGE_SIZE = 50
const ACTIVE_MERGE_JOB_STATUSES = ['pending', 'submitted', 'running']
const DUPLICATE_BLOCKING_MERGE_JOB_STATUSES = [
  ...ACTIVE_MERGE_JOB_STATUSES,
  'succeeded',
]
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

const mergePeriodTypeSchema = z.enum(['annual', 'quarterly'])

export const certificateMergeRequestSchema = z
  .object({
    payeeShortName: z.string().trim().min(1),
    periodType: mergePeriodTypeSchema,
    year: z.number().int().min(2000).max(2100),
    quarter: z.number().int().min(1).max(4).optional(),
  })
  .superRefine((value, ctx) => {
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
  })

export type CertificateMergeRequest = z.infer<
  typeof certificateMergeRequestSchema
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
  documentResultId: number
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

export const shouldSkipAwsBatchMergeSubmission = () =>
  TRUE_ENV_VALUES.has(
    process.env.MERGE_JOBS_SKIP_AWS_BATCH?.trim().toLowerCase() ?? '',
  )

const batchToJobStatus = (status: string | undefined) => {
  switch (status) {
    case 'SUCCEEDED':
      return 'succeeded'
    case 'FAILED':
      return 'failed'
    case 'STARTING':
    case 'RUNNING':
      return 'running'
    case 'SUBMITTED':
    case 'PENDING':
    case 'RUNNABLE':
      return 'submitted'
    default:
      return null
  }
}

const toIsoString = (value: Date | null | undefined) =>
  value?.toISOString() ?? null

const readCount = (rows: Array<CountRow>) => Number(rows.at(0)?.value ?? 0)

const toMergePeriod = (
  input: CertificateMergeRequest,
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
    documentResultId: number
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
      documentResultId: input.documentResultId,
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
    documentResultId: input.documentResultId,
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
      documentResultId: documentResults.id,
      periodEnd: documentResults.periodEnd,
    })
    .from(documentResults)
    .leftJoin(
      certificateMergeAssignments,
      and(
        eq(certificateMergeAssignments.documentResultId, documentResults.id),
        eq(certificateMergeAssignments.packageType, input.packageType),
      ),
    )
    .where(
      and(
        eq(documentResults.status, 'success'),
        sql`lower(coalesce(${documentResults.payeeShortName}, '')) = ${input.payeeShortName.toLowerCase()}`,
        isNotNull(documentResults.periodEnd),
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
        documentResultId: row.documentResultId,
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
  input: CertificateMergeRequest,
  entityTin: string,
): Promise<Array<SignedMergeCandidate>> => {
  const db = getDb()
  const packageType = normalizePackageType(input.periodType)
  if (!packageType) return []

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
      documentResultId: documentResults.id,
      mergeAssignmentId: certificateMergeAssignments.id,
      signedArtifactId: certificateSignedArtifacts.id,
      signedPdfKey: certificateSignedArtifacts.signedPdfKey,
      originalFileName: documentResults.originalFileName,
      payorName: documentResults.payorName,
      payorTin: documentResults.payorTin,
      payeeTin: documentResults.payeeTin,
      periodEnd: documentResults.periodEnd,
      createdAt: documentResults.createdAt,
      assignmentPackageType: certificateMergeAssignments.packageType,
      sourceYear: certificateMergeAssignments.sourceYear,
      sourceQuarter: certificateMergeAssignments.sourceQuarter,
      assignedYear: certificateMergeAssignments.assignedYear,
      assignedQuarter: certificateMergeAssignments.assignedQuarter,
      isLate: certificateMergeAssignments.isLate,
      assignmentReason: certificateMergeAssignments.reason,
    })
    .from(documentResults)
    .innerJoin(
      certificateSignedArtifacts,
      eq(certificateSignedArtifacts.documentResultId, documentResults.id),
    )
    .innerJoin(
      certificateMergeAssignments,
      and(
        eq(certificateMergeAssignments.documentResultId, documentResults.id),
        eq(certificateMergeAssignments.packageType, packageType),
      ),
    )
    .where(
      and(
        eq(documentResults.status, 'success'),
        sql`lower(coalesce(${documentResults.payeeShortName}, '')) = ${input.payeeShortName.toLowerCase()}`,
        assignedPeriodCondition,
        eq(certificateMergeAssignments.status, 'assigned'),
        eq(certificateSignedArtifacts.status, 'signed'),
        isNotNull(certificateSignedArtifacts.signedPdfKey),
      ),
    )
    .orderBy(asc(documentResults.id))
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

const getSignedObjectSizes = async (
  candidates: Array<SignedMergeCandidate>,
): Promise<Array<SizedSignedMergeCandidate>> => {
  const bucket = getStorageBucketName()
  const s3 = createS3ServerClient()

  return Promise.all(
    candidates.map(async (candidate) => {
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: candidate.signedPdfKey,
        }),
      )
      const sizeBytes = Number(head.ContentLength ?? 0)

      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new Error(
          `Signed PDF is missing or empty: ${candidate.signedPdfKey}`,
        )
      }

      return {
        ...candidate,
        id: String(candidate.documentResultId),
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
      inputIds: part.inputs.map((item) => item.documentResultId),
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
      documentResultId: candidate.documentResultId,
      fileName:
        candidate.originalFileName ?? `Document ${candidate.documentResultId}`,
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

export const previewCertificateMergeJob = async (
  input: CertificateMergeRequest,
) => {
  const parsed = certificateMergeRequestSchema.parse(input)
  const entity = await requireEntity(parsed.payeeShortName)
  await assertNoExistingMergeJobForPeriod(parsed, entity.tin)
  const candidates = await getSignedMergeCandidates(parsed, entity.tin)

  if (candidates.length === 0) {
    throw new Error(
      'No signed 2307 PDFs were found for this entity and period.',
    )
  }

  const sizedCandidates = await getSignedObjectSizes(candidates)
  return buildPreviewFromSizedCandidates(parsed, entity.tin, sizedCandidates)
}

const submitAwsBatchMergeJob = async (mergeJobId: string) => {
  const batch = createBatchServerClient()
  const response = await batch.send(
    new SubmitJobCommand({
      jobName: `certificate-merge-${mergeJobId}`,
      jobQueue: getMergeBatchJobQueue(),
      jobDefinition: getMergeBatchJobDefinition(),
      containerOverrides: {
        environment: [
          {
            name: 'MERGE_JOB_ID',
            value: mergeJobId,
          },
        ],
      },
    }),
  )

  if (!response.jobId) {
    throw new Error('AWS Batch did not return a job id.')
  }

  return response.jobId
}

const getMergeJobBatchIds = async (mergeJobId: string, partNumber?: number) => {
  const rows = await getDb()
    .select({ batchId: documentResults.batchId })
    .from(certificateMergeJobInputs)
    .innerJoin(
      documentResults,
      eq(documentResults.id, certificateMergeJobInputs.documentResultId),
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
  const parsed = certificateMergeRequestSchema.parse(input.request)
  const entity = await requireEntity(parsed.payeeShortName)
  await assertNoExistingMergeJobForPeriod(parsed, entity.tin)
  const candidates = await getSignedObjectSizes(
    await getSignedMergeCandidates(parsed, entity.tin),
  )

  if (candidates.length === 0) {
    throw new Error(
      'No signed 2307 PDFs were found for this entity and period.',
    )
  }

  const preview = buildPreviewFromSizedCandidates(
    parsed,
    entity.tin,
    candidates,
  )
  const db = getDb()
  const now = new Date()

  const mergeJob = await db.transaction(async (tx) => {
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
        documentResultId: candidate.documentResultId,
        signedArtifactId: candidate.signedArtifactId,
        signedPdfKey: candidate.signedPdfKey,
        sizeBytes: candidate.sizeBytes,
        inputOrder: index + 1,
        outputPartNumber: partByInputId.get(candidate.documentResultId) ?? null,
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

  if (shouldSkipAwsBatchMergeSubmission()) {
    return getCertificateMergeJobView({
      mergeJobId: mergeJob.id,
      userId: input.userId,
      allowAdmin: true,
    })
  }

  try {
    const awsBatchJobId = await submitAwsBatchMergeJob(mergeJob.id)
    await db
      .update(certificateMergeJobs)
      .set({
        awsBatchJobId,
        awsBatchStatus: 'SUBMITTED',
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
  documentId: number
  userId: string
  request: CertificateMergeAssignmentOverrideRequest
}): Promise<MergeAssignmentRecord> => {
  const parsed = certificateMergeAssignmentOverrideSchema.parse(input.request)
  const packageType = parsed.packageType as CertificateMergePackageType
  const db = getDb()
  const rows = await db
    .select()
    .from(documentResults)
    .where(eq(documentResults.id, input.documentId))
    .limit(1)
  const document = rows.at(0) ?? null

  if (!document || document.status !== 'success') {
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
    documentResultId: input.documentId,
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
        certificateMergeAssignments.documentResultId,
        certificateMergeAssignments.packageType,
      ],
      set: values,
    })
    .returning()

  return assignment
}

const syncAwsBatchStatus = async (job: MergeJobRecord) => {
  if (!job.awsBatchJobId || ['succeeded', 'failed'].includes(job.status)) {
    return job
  }

  try {
    const response = await createBatchServerClient().send(
      new DescribeJobsCommand({
        jobs: [job.awsBatchJobId],
      }),
    )
    const batchJob = response.jobs?.at(0)
    const batchStatus = batchJob?.status
    const nextStatus = batchToJobStatus(batchStatus)

    if (!batchStatus || !nextStatus) {
      return job
    }

    const status =
      job.status === 'running' && nextStatus === 'submitted'
        ? job.status
        : nextStatus
    const now = new Date()
    const update = {
      awsBatchStatus: batchStatus,
      status,
      errorMessage:
        status === 'failed'
          ? (batchJob.statusReason ?? job.errorMessage)
          : job.errorMessage,
      startedAt:
        !job.startedAt &&
        typeof batchJob.startedAt === 'number' &&
        batchJob.startedAt > 0
          ? new Date(batchJob.startedAt)
          : job.startedAt,
      finishedAt:
        ['succeeded', 'failed'].includes(status) && !job.finishedAt
          ? now
          : job.finishedAt,
      updatedAt: now,
    }

    const [updated] = await getDb()
      .update(certificateMergeJobs)
      .set(update)
      .where(eq(certificateMergeJobs.id, job.id))
      .returning()

    await recordMergeTimingForJob(updated).catch(logBatchStageTimingError)

    return updated
  } catch {
    return job
  }
}

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
  awsBatchJobId: job.awsBatchJobId,
  awsBatchStatus: job.awsBatchStatus,
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
    documentResultId: input.documentResultId,
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

  const syncedJob = await syncAwsBatchStatus(job)
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
    jobs.map((job) => syncAwsBatchStatus(job)),
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
  const url = await getSignedUrl(
    createS3ServerClient() as never,
    new GetObjectCommand({
      Bucket: bucket,
      Key: output.outputKey,
      ResponseContentDisposition: `attachment; filename="${output.fileName.replace(/[\\"]/g, '_')}"`,
      ResponseContentType: 'application/pdf',
    }) as never,
    { expiresIn: DOWNLOAD_EXPIRY_SECONDS },
  )
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
    region: getAwsRegion(),
  }
}
