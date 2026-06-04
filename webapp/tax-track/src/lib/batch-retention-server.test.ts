import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Array<unknown>>,
  send: vi.fn(),
  transaction: vi.fn(),
  deleteWhereCalls: [] as Array<unknown>,
  updateWhereCalls: [] as Array<unknown>,
  insertValues: [] as Array<unknown>,
}))

const createSelectChain = (rows: Array<unknown>) => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Array<unknown>) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  }

  return chain
}

const createMutationChain = (target: Array<unknown>) => {
  const chain = {
    set: vi.fn(() => chain),
    values: vi.fn((value: unknown) => {
      mocks.insertValues.push(value)
      return Promise.resolve()
    }),
    where: vi.fn((condition: unknown) => {
      target.push(condition)
      return Promise.resolve()
    }),
  }

  return chain
}

vi.mock('@/lib/aws-server', () => ({
  createS3ServerClient: () => ({ send: mocks.send }),
  getStorageBucketName: () => 'taxtrack-storage',
}))

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: vi.fn(() => {
      const rows = mocks.selectRows.shift()
      if (!rows) {
        throw new Error('Unexpected select query')
      }

      return createSelectChain(rows)
    }),
    transaction: mocks.transaction.mockImplementation(async (work) =>
      work({
        delete: vi.fn(() => createMutationChain(mocks.deleteWhereCalls)),
        update: vi.fn(() => createMutationChain(mocks.updateWhereCalls)),
        insert: vi.fn(() => createMutationChain(mocks.insertValues)),
      }),
    ),
  }),
}))

const { purgeExpiredUploadBatches } =
  await import('@/lib/batch-retention-server')

describe('purgeExpiredUploadBatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows.length = 0
    mocks.deleteWhereCalls.length = 0
    mocks.updateWhereCalls.length = 0
    mocks.insertValues.length = 0
    mocks.send.mockResolvedValue({})
  })

  it('leaves non-expired batches alone', async () => {
    mocks.selectRows.push([])

    const result = await purgeExpiredUploadBatches({
      now: new Date('2026-05-31T10:00:00.000Z'),
    })

    expect(result).toEqual([])
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('collects S3 keys and purges expired batch rows', async () => {
    mocks.selectRows.push(
      [{ id: '7de4cd8e-6be8-4928-a2cb-e417654c8e15' }],
      [
        {
          storageKey: 'uploads/source.pdf',
          artifactUri: 's3://taxtrack-storage/uploads/artifact.pdf',
        },
      ],
      [
        {
          id: 101,
          finalKey: 'results/final.json',
          artifactKey: 'results/artifact.json',
          payload: {
            artifactKeys: [
              'payload/a.json',
              's3://taxtrack-storage/payload/b.json',
            ],
            renamedPdf: 'payload/renamed.pdf',
          },
        },
      ],
      [{ jobId: 'worker-job-1' }],
      [
        {
          sourcePdfKey: 'signed/source.pdf',
          signedPdfKey: 'signed/output.pdf',
        },
      ],
      [{ mergeJobId: '9de4cd8e-6be8-4928-a2cb-e417654c8e15' }],
      [{ outputKey: 'merge/output.pdf' }],
    )

    const result = await purgeExpiredUploadBatches({
      now: new Date('2026-05-31T10:00:00.000Z'),
    })

    expect(result).toEqual([
      {
        batchId: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
        objectKeyCount: 10,
        failedObjectDeleteCount: 0,
      },
    ])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send.mock.calls[0]?.[0].input.Delete.Objects).toEqual(
      expect.arrayContaining([
        { Key: 'uploads/source.pdf' },
        { Key: 'uploads/artifact.pdf' },
        { Key: 'payload/a.json' },
        { Key: 'merge/output.pdf' },
      ]),
    )
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.insertValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'batch_purged',
          targetId: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
        }),
      ]),
    )
  })
})
