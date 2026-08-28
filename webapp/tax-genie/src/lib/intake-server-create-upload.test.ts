import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  type RowQueue = Array<Array<unknown>>
  type UpdateSet = Record<string, unknown>

  const selectQueue: RowQueue = []
  const txSelectQueue: RowQueue = []
  const updateReturningQueue: RowQueue = []
  const txInsertReturningQueue: RowQueue = []
  const txUpdateReturningQueue: RowQueue = []
  const executeQueue: RowQueue = []
  const updateSets: Array<UpdateSet> = []
  const txUpdateSets: Array<UpdateSet> = []
  const insertValues: Array<unknown> = []
  const txInsertValues: Array<unknown> = []

  const resolveNextRows = (queue: RowQueue) =>
    Promise.resolve(queue.shift() ?? [])

  const createWhereResult = (queue: RowQueue) => {
    const resolve = () => resolveNextRows(queue)

    return {
      limit: vi.fn(resolve),
      orderBy: vi.fn(resolve),
      then: (
        onFulfilled: (value: Array<unknown>) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => resolve().then(onFulfilled, onRejected),
    }
  }

  const createSelect = (queue: RowQueue) =>
    vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult(queue)),
      })),
    }))

  const createUpdate = (
    queue: RowQueue,
    updateSetTarget: Array<UpdateSet>,
  ) =>
    vi.fn(() => ({
      set: vi.fn((values: UpdateSet) => {
        updateSetTarget.push(values)

        return {
          where: vi.fn(() => {
            const resolve = () => Promise.resolve(undefined)

            return {
              returning: vi.fn(() => resolveNextRows(queue)),
              then: (
                onFulfilled: (value: undefined) => unknown,
                onRejected?: (reason: unknown) => unknown,
              ) => resolve().then(onFulfilled, onRejected),
            }
          }),
        }
      }),
    }))

  const createInsert = (
    queue: RowQueue,
    insertValueTarget: Array<unknown>,
  ) =>
    vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        insertValueTarget.push(values)
        const resolve = () => Promise.resolve(undefined)

        return {
          returning: vi.fn(() => resolveNextRows(queue)),
          then: (
            onFulfilled: (value: undefined) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => resolve().then(onFulfilled, onRejected),
        }
      }),
    }))

  const tx = {
    execute: vi.fn(),
    select: createSelect(txSelectQueue),
    insert: createInsert(txInsertReturningQueue, txInsertValues),
    update: createUpdate(txUpdateReturningQueue, txUpdateSets),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(undefined)),
    })),
  }

  const db = {
    execute: vi.fn(() =>
      Promise.resolve({
        rows: executeQueue.shift() ?? [],
      }),
    ),
    select: createSelect(selectQueue),
    insert: createInsert([], insertValues),
    update: createUpdate(updateReturningQueue, updateSets),
    transaction: vi.fn((work: (txInput: typeof tx) => unknown) =>
      Promise.resolve(work(tx)),
    ),
  }

  return {
    db,
    executeQueue,
    getSignedUrl: vi.fn(),
    insertValues,
    selectQueue,
    tx,
    txInsertReturningQueue,
    txInsertValues,
    txSelectQueue,
    txUpdateReturningQueue,
    txUpdateSets,
    updateReturningQueue,
    updateSets,
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}))

vi.mock('@/lib/aws-server', () => ({
  createS3ServerClient: () => ({}),
  createSqsServerClient: () => ({}),
  getAwsRegion: () => 'ap-southeast-1',
  getQueueUrl: () => 'https://sqs.example.test/taxgenie',
  getStorageBucketName: () => 'taxgenie-test-bucket',
  getStoragePrefix: () => 'test-prefix',
  sanitizeUploadFileName: (value: string) => value,
}))

vi.mock('@/lib/batch-stage-timing-server', () => ({
  logBatchStageTimingError: vi.fn(),
  recordBatchStageTiming: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: () => mocks.db,
}))

const { createUpload } = await import('@/lib/intake-server')

const createdAt = new Date('2026-05-31T16:00:00.000Z')

const buildBatchRecord = (overrides: Record<string, unknown> = {}) => ({
  id: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
  name: null,
  entityId: null,
  entityShortName: null,
  entityCompanyName: null,
  entityTin: null,
  createdByUserId: 'user-1',
  status: 'open',
  totalFiles: 0,
  lastActivityAt: createdAt,
  closedAt: null,
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
})

const entityRecord = {
  id: 1,
  shortName: 'AESI',
  companyName: 'Aboitiz Energy Solutions, Inc.',
  tin: '123456789000',
}

const summaryRow = {
  activeFileCount: 1,
  pendingCount: 1,
  uploadedCount: 0,
  queuedCount: 0,
  processingCount: 0,
  successCount: 0,
  duplicateCount: 0,
  errorCount: 0,
  openAttentionCount: 0,
  certificateCount: 0,
  signedCount: 0,
  reconciledCount: 0,
}

const uploadFile = {
  name: 'certificate.pdf',
  type: 'application/pdf',
  size: 2048,
}

describe('createUpload default batch name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectQueue.length = 0
    mocks.txSelectQueue.length = 0
    mocks.updateReturningQueue.length = 0
    mocks.txInsertReturningQueue.length = 0
    mocks.txUpdateReturningQueue.length = 0
    mocks.executeQueue.length = 0
    mocks.updateSets.length = 0
    mocks.txUpdateSets.length = 0
    mocks.insertValues.length = 0
    mocks.txInsertValues.length = 0
    mocks.getSignedUrl.mockResolvedValue('https://uploads.example.test/file')
  })

  it('sets a default name when a new upload batch is first locked to an entity', async () => {
    const createdBatch = buildBatchRecord()
    const namedEntityBatch = buildBatchRecord({
      name: 'AESI - Jun 01, 2026',
      entityId: entityRecord.id,
      entityShortName: entityRecord.shortName,
      entityCompanyName: entityRecord.companyName,
      entityTin: entityRecord.tin,
    })

    mocks.selectQueue.push([entityRecord], [namedEntityBatch])
    mocks.txSelectQueue.push([], [{ totalFiles: 0 }])
    mocks.txInsertReturningQueue.push([createdBatch])
    mocks.txUpdateReturningQueue.push([createdBatch])
    mocks.updateReturningQueue.push([namedEntityBatch])
    mocks.executeQueue.push([summaryRow])

    const result = await createUpload({
      userId: 'user-1',
      entityId: entityRecord.id,
      files: [uploadFile],
    })

    expect(result.batch.name).toBe('AESI - Jun 01, 2026')
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'AESI - Jun 01, 2026',
          entityId: entityRecord.id,
          entityShortName: entityRecord.shortName,
          entityCompanyName: entityRecord.companyName,
          entityTin: entityRecord.tin,
        }),
      ]),
    )
  })

  it('preserves an existing batch name when the batch is first locked to an entity', async () => {
    const existingBatch = buildBatchRecord({
      name: 'Custom withholding upload',
    })
    const namedEntityBatch = buildBatchRecord({
      name: 'Custom withholding upload',
      entityId: entityRecord.id,
      entityShortName: entityRecord.shortName,
      entityCompanyName: entityRecord.companyName,
      entityTin: entityRecord.tin,
    })

    mocks.selectQueue.push([entityRecord], [namedEntityBatch])
    mocks.txSelectQueue.push([existingBatch], [{ totalFiles: 0 }])
    mocks.txUpdateReturningQueue.push([existingBatch])
    mocks.updateReturningQueue.push([namedEntityBatch])
    mocks.executeQueue.push([summaryRow])

    const result = await createUpload({
      userId: 'user-1',
      entityId: entityRecord.id,
      files: [uploadFile],
    })

    expect(result.batch.name).toBe('Custom withholding upload')
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Custom withholding upload',
          entityId: entityRecord.id,
        }),
      ]),
    )
    expect(mocks.updateSets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'AESI - Jun 01, 2026',
        }),
      ]),
    )
  })
})
