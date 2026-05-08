import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { DescribeJobsCommand, SubmitJobCommand } from '@aws-sdk/client-batch'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  MERGE_TOTAL_SIZE_LIMIT_BYTES,
  buildEntityStorageKey,
  buildCertificateMergeFileName,
  buildMergeOutputKey,
  getCertificateMergePeriodRange,
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

import {
  createBatchServerClient,
  createS3ServerClient,
  getAwsRegion,
  getMergeBatchJobDefinition,
  getMergeBatchJobQueue,
  getStorageBucketName,
  getStoragePrefix,
} from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import {
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

type MergeJobRecord = typeof certificateMergeJobs.$inferSelect
type MergeOutputRecord = typeof certificateMergeJobOutputs.$inferSelect
type MergeInputRecord = typeof certificateMergeJobInputs.$inferSelect
type CountRow = { value: number | string | bigint | null }

export type CertificateMergeJobListView = 'recent' | 'all'

type SignedMergeCandidate = {
  documentResultId: number
  signedArtifactId: string
  signedPdfKey: string
  originalFileName: string | null
  payorName: string | null
  payorTin: string | null
  payeeTin: string | null
  periodEnd: string | null
  createdAt: Date
}

type SizedSignedMergeCandidate = SignedMergeCandidate & {
  id: string
  sizeBytes: number
}

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

const getSignedMergeCandidates = async (
  input: CertificateMergeRequest,
): Promise<Array<SignedMergeCandidate>> => {
  const db = getDb()
  const period = toMergePeriod(input)
  const range = getCertificateMergePeriodRange(period)

  return db
    .select({
      documentResultId: documentResults.id,
      signedArtifactId: certificateSignedArtifacts.id,
      signedPdfKey: certificateSignedArtifacts.signedPdfKey,
      originalFileName: documentResults.originalFileName,
      payorName: documentResults.payorName,
      payorTin: documentResults.payorTin,
      payeeTin: documentResults.payeeTin,
      periodEnd: documentResults.periodEnd,
      createdAt: documentResults.createdAt,
    })
    .from(documentResults)
    .innerJoin(
      certificateSignedArtifacts,
      eq(certificateSignedArtifacts.documentResultId, documentResults.id),
    )
    .where(
      and(
        eq(documentResults.status, 'success'),
        sql`lower(coalesce(${documentResults.payeeShortName}, '')) = ${input.payeeShortName.toLowerCase()}`,
        sql`${documentResults.periodEnd} >= ${range.startDate}`,
        sql`${documentResults.periodEnd} < ${range.endDate}`,
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
  const candidates = await getSignedMergeCandidates(parsed)

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

export const createCertificateMergeJob = async (input: {
  request: CertificateMergeRequest
  userId: string
}) => {
  const parsed = certificateMergeRequestSchema.parse(input.request)
  const entity = await requireEntity(parsed.payeeShortName)
  await assertNoExistingMergeJobForPeriod(parsed, entity.tin)
  const candidates = await getSignedObjectSizes(
    await getSignedMergeCandidates(parsed),
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

  return {
    url,
    expiresIn: DOWNLOAD_EXPIRY_SECONDS,
    fileName: output.fileName,
    bucket,
    region: getAwsRegion(),
  }
}
