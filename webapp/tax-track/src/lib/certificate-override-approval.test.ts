import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  s3Send: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
}))

vi.mock('@/lib/aws-server', () => ({
  createS3ServerClient: () => ({ send: mocks.s3Send }),
  getStorageBucketName: () => 'taxtrack-storage',
  getStoragePrefix: () => 'v2',
}))

const { approveCertificateOverrideRequest } =
  await import('@/lib/certificate-override-server')

const createDecisionRecord = (
  overrides: {
    storageKey?: string
    storageBucket?: string
  } = {},
) => ({
  request: {
    id: 'override-1',
    documentResultId: 123,
    uploadId: '22222222-2222-2222-2222-222222222222',
    batchId: '11111111-1111-1111-1111-111111111111',
    status: 'pending',
    requestedByUserId: 'editor-1',
    requestNote: 'Business approved exception.',
    decisionNote: null,
    resolvedMasterlistMatch: {
      matchMode: 'payorTin',
      shortName: 'CUST',
      customerName: 'Payor A',
      tin: '123-456-789-000',
      region: null,
      entity: null,
    },
    originalValidation: {
      status: 'invalid',
      reasons: ['masterlist_payor_not_found'],
    },
  },
  result: {
    id: 123,
    status: 'error',
    outcome: 'Error',
    finalKey:
      'v2/entities/aesi-7/customers/cust/processing/batch-1/upload-1/rev-1/error.json',
    artifactKey:
      'v2/entities/aesi-7/customers/cust/processing/batch-1/upload-1/rev-1/error.json',
    payload: {
      payloadVersion: 2,
      status: 'error',
      event: {
        selectedEntity: {
          id: 7,
          shortName: 'AESI',
        },
      },
      normalized: {
        periodEnd: '08-31-2025',
        payeeName: 'Payee A',
        payeeTin: '266-566-116-000',
        payorName: 'Original Payor',
        payorTin: '000-000-000-000',
        taxBase: '100.00',
        taxWithheld: '2.00',
      },
      artifactKeys: {
        finalResultJson:
          'v2/entities/aesi-7/customers/cust/processing/batch-1/upload-1/rev-1/error.json',
      },
    },
    revision: 'rev-1',
    sourceFileId: 'source-1',
    originalFileName: 'certificate.pdf',
  },
  file: {
    id: '22222222-2222-2222-2222-222222222222',
    batchId: '11111111-1111-1111-1111-111111111111',
    originalFileName: 'certificate.pdf',
    storageBucket: overrides.storageBucket ?? 'source-bucket',
    storageKey: overrides.storageKey ?? 'uploads/source.pdf',
    uploadedAt: new Date('2025-08-15T10:30:00.000Z'),
  },
  batch: {
    id: '11111111-1111-1111-1111-111111111111',
    entityId: 7,
    entityShortName: 'AESI',
    entityCompanyName: 'Aboitiz Energy Solutions, Inc.',
  },
})

const createDb = (input: {
  record?: ReturnType<typeof createDecisionRecord>
  processedCount?: number
}) => {
  const record = input.record ?? createDecisionRecord()
  const updates: Array<{ values: Record<string, unknown> }> = []
  const tx = {
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () =>
            Promise.resolve([{ value: (input.processedCount ?? 2) + 1 }]),
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ values })

        return {
          where: () => Promise.resolve(undefined),
        }
      },
    })),
  }
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({
                limit: () => Promise.resolve([record]),
              }),
            }),
          }),
        }),
      }),
    })),
    transaction: vi.fn((callback: (txArg: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  }

  return { db, tx, updates }
}

describe('approveCertificateOverrideRequest artifact promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.s3Send.mockResolvedValue({})
  })

  it('copies the source PDF, writes final-result.json, and promotes canonical keys', async () => {
    const harness = createDb({})
    mocks.getDb.mockReturnValue(harness.db)

    const result = await approveCertificateOverrideRequest({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Reviewed and approved.',
    })

    const expectedFinalKey =
      'v2/entities/aesi-7/customers/cust/certificates/2025-08/11111111-1111-1111-1111-111111111111/123/unsigned/Original_Payor_000000000000_08312025_3.pdf'
    const expectedArtifactKey =
      'v2/entities/aesi-7/customers/cust/processing/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/rev-1/final-result.json'
    const documentUpdate = harness.updates.find(
      (update) => update.values.finalKey === expectedFinalKey,
    )?.values
    const [copyCommand, putCommand] = mocks.s3Send.mock.calls.map(
      ([command]) =>
        command as {
          input: Record<string, unknown>
        },
    )
    const persistedPayload = JSON.parse(String(putCommand.input.Body)) as {
      artifactKeys: Record<string, unknown>
      override: Record<string, unknown>
      normalized: Record<string, unknown>
    }

    expect(result).toEqual({
      requestId: 'override-1',
      documentResultId: 123,
      matchedCount: 0,
    })
    expect(copyCommand.input).toMatchObject({
      Bucket: 'taxtrack-storage',
      Key: expectedFinalKey,
      CopySource: 'source-bucket/uploads/source.pdf',
    })
    expect(putCommand.input).toMatchObject({
      Bucket: 'taxtrack-storage',
      Key: expectedArtifactKey,
      ContentType: 'application/json',
    })
    expect(documentUpdate).toMatchObject({
      status: 'success',
      outcome: 'Done',
      finalKey: expectedFinalKey,
      artifactKey: expectedArtifactKey,
      payorName: 'Original Payor',
      payorTin: '000-000-000-000',
      payorShortName: 'CUST',
      overrideStatus: 'approved',
    })
    expect(documentUpdate?.overridePatch).toMatchObject({
      originalFinalKey:
        'v2/entities/aesi-7/customers/cust/processing/batch-1/upload-1/rev-1/error.json',
      originalArtifactKey:
        'v2/entities/aesi-7/customers/cust/processing/batch-1/upload-1/rev-1/error.json',
      approvedFinalKey: expectedFinalKey,
      approvedArtifactKey: expectedArtifactKey,
    })
    expect(persistedPayload.artifactKeys).toMatchObject({
      finalResultJson: expectedArtifactKey,
      renamedPdf: expectedFinalKey,
    })
    expect(persistedPayload.override).toMatchObject({
      approvedFinalKey: expectedFinalKey,
      approvedArtifactKey: expectedArtifactKey,
    })
    expect(persistedPayload.normalized).toMatchObject({
      payorName: 'Original Payor',
      payorTin: '000-000-000-000',
    })
  })

  it('does not approve the request when source storage is missing', async () => {
    const harness = createDb({
      record: createDecisionRecord({ storageKey: '' }),
    })
    mocks.getDb.mockReturnValue(harness.db)

    await expect(
      approveCertificateOverrideRequest({
        requestId: 'override-1',
        userId: 'admin-1',
        decisionNote: 'Reviewed and approved.',
      }),
    ).rejects.toThrow('No source PDF is available')

    expect(harness.db.transaction).not.toHaveBeenCalled()
    expect(mocks.s3Send).not.toHaveBeenCalled()
  })

  it('leaves the request unapproved when S3 promotion fails', async () => {
    const harness = createDb({})
    mocks.getDb.mockReturnValue(harness.db)
    mocks.s3Send.mockRejectedValueOnce(new Error('S3 copy failed'))

    await expect(
      approveCertificateOverrideRequest({
        requestId: 'override-1',
        userId: 'admin-1',
        decisionNote: 'Reviewed and approved.',
      }),
    ).rejects.toThrow('S3 copy failed')

    expect(harness.updates).toEqual([])
  })
})
