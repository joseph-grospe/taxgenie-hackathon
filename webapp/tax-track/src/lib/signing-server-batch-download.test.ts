import { Buffer } from 'node:buffer'

import { PgDialect } from 'drizzle-orm/pg-core'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GetObjectCommand } from '@aws-sdk/client-s3'

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Array<unknown>>,
  send: vi.fn(),
  updateSetValues: [] as Array<Record<string, unknown>>,
  updateWhereCalls: [] as Array<unknown>,
  selectWhereCalls: [] as Array<unknown>,
}))

const createSelectChain = (rows: Array<unknown>) => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn((condition: unknown) => {
      mocks.selectWhereCalls.push(condition)
      return chain
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Array<unknown>) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  }

  return chain
}

const createUpdateChain = () => {
  const chain = {
    set: vi.fn((value: Record<string, unknown>) => {
      mocks.updateSetValues.push(value)
      return chain
    }),
    where: vi.fn((condition: unknown) => {
      mocks.updateWhereCalls.push(condition)
      return Promise.resolve()
    }),
  }

  return chain
}

vi.mock('@/lib/aws-server', () => ({
  createS3ServerClient: () => ({ send: mocks.send }),
  getStorageBucketName: () => 'taxtrack-storage',
  getStoragePrefix: () => '',
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
    update: vi.fn(() => createUpdateChain()),
  }),
}))

const {
  buildSignedCertificateZipEntryName,
  getSignedBatchCertificatesZipDownload,
} = await import('@/lib/signing-server')

const dialect = new PgDialect()
const renderQuery = (query: unknown) => dialect.sqlToQuery(query as never)

describe('getSignedBatchCertificatesZipDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows.length = 0
    mocks.updateSetValues.length = 0
    mocks.updateWhereCalls.length = 0
    mocks.selectWhereCalls.length = 0
    mocks.send.mockImplementation((command: GetObjectCommand) => {
      const key = command.input.Key ?? ''

      return {
        Body: {
          transformToByteArray: () =>
            Uint8Array.from(Buffer.from(`PDF:${key}`)),
        },
      }
    })
  })

  it('builds a zip from signed active certificates and updates download tracking', async () => {
    mocks.selectRows.push(
      [{ id: 'batch-1', name: 'April Batch', status: 'closed' }],
      [
        { id: 'file-1', batchId: 'batch-1', removedFromBatchAt: null },
        { id: 'file-2', batchId: 'batch-1', removedFromBatchAt: null },
      ],
      [
        {
          id: 11,
          uploadId: 'file-1',
          status: 'accepted',
          artifactKey: 'Final.pdf',
        },
        {
          id: 12,
          uploadId: 'file-2',
          status: 'accepted',
          artifactKey: 'Final.pdf',
        },
        {
          id: 13,
          uploadId: 'removed-file',
          status: 'accepted',
          artifactKey: 'Removed.pdf',
        },
        {
          id: 14,
          uploadId: 'file-2',
          status: 'error',
          artifactKey: 'Error.pdf',
        },
      ],
      [
        {
          id: 'artifact-1',
          certificateId: 11,
          status: 'signed',
          signedPdfKey: 'signed/one.pdf',
        },
        {
          id: 'artifact-2',
          certificateId: 12,
          status: 'signed',
          signedPdfKey: 'signed/two.pdf',
        },
        {
          id: 'artifact-removed',
          certificateId: 13,
          status: 'signed',
          signedPdfKey: 'signed/removed.pdf',
        },
        {
          id: 'artifact-failed',
          certificateId: 14,
          status: 'signed',
          signedPdfKey: 'signed/error.pdf',
        },
      ],
    )

    const download = await getSignedBatchCertificatesZipDownload({
      batchId: 'batch-1',
      downloaderUserId: 'user-1',
    })

    const entries = unzipSync(download.bytes)
    expect(download.fileName).toBe('Signed-Certificates-April Batch.zip')
    expect(Object.keys(entries).sort()).toEqual(['Final (2).pdf', 'Final.pdf'])
    expect(Buffer.from(entries['Final.pdf']).toString('utf8')).toBe(
      'PDF:signed/one.pdf',
    )
    expect(Buffer.from(entries['Final (2).pdf']).toString('utf8')).toBe(
      'PDF:signed/two.pdf',
    )
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.updateSetValues).toHaveLength(1)
    expect(mocks.updateSetValues[0]).toEqual(
      expect.objectContaining({
        lastDownloadedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    )
    expect(mocks.updateWhereCalls).toHaveLength(1)
  })

  it('queries only non-removed files from a non-deleted closed batch', async () => {
    mocks.selectRows.push(
      [{ id: 'batch-1', name: null, status: 'closed' }],
      [{ id: 'file-1', batchId: 'batch-1', removedFromBatchAt: null }],
      [
        {
          id: 11,
          uploadId: 'file-1',
          status: 'accepted',
          artifactKey: 'One.pdf',
        },
      ],
      [
        {
          id: 'artifact-1',
          certificateId: 11,
          status: 'signed',
          signedPdfKey: 'signed/one.pdf',
        },
      ],
    )

    await getSignedBatchCertificatesZipDownload({ batchId: 'batch-1' })

    const batchWhere = renderQuery(mocks.selectWhereCalls[0]).sql
    const filesWhere = renderQuery(mocks.selectWhereCalls[1]).sql
    expect(batchWhere).toContain('"intake_batches"."deleted_at" is null')
    expect(filesWhere).toContain(
      '"intake_files"."removed_from_batch_at" is null',
    )
  })

  it('fails when no signed PDFs are available', async () => {
    mocks.selectRows.push(
      [{ id: 'batch-1', name: null, status: 'closed' }],
      [{ id: 'file-1', batchId: 'batch-1', removedFromBatchAt: null }],
      [
        {
          id: 11,
          uploadId: 'file-1',
          status: 'accepted',
          artifactKey: 'One.pdf',
        },
      ],
      [
        {
          id: 'artifact-1',
          certificateId: 11,
          status: 'failed',
          signedPdfKey: null,
        },
      ],
    )

    await expect(
      getSignedBatchCertificatesZipDownload({ batchId: 'batch-1' }),
    ).rejects.toThrow('No signed certificate PDFs were found for this batch.')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.updateSetValues).toHaveLength(0)
  })
})

describe('buildSignedCertificateZipEntryName', () => {
  it('sanitizes duplicate file names for zip entries', () => {
    const usedNames = new Set<string>()

    expect(buildSignedCertificateZipEntryName('../Final.pdf', usedNames)).toBe(
      'Final.pdf',
    )
    expect(buildSignedCertificateZipEntryName('../Final.pdf', usedNames)).toBe(
      'Final (2).pdf',
    )
    expect(buildSignedCertificateZipEntryName('Signed Result', usedNames)).toBe(
      'Signed Result.pdf',
    )
  })
})
