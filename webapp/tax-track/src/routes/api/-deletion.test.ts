import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  logAuditEvent: vi.fn(),
  queueBatchPurge: vi.fn(),
  queueUploadPurge: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))
vi.mock('@/lib/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/deletion-server', () => ({
  queueBatchPurge: mocks.queueBatchPurge,
  queueUploadPurge: mocks.queueUploadPurge,
}))
vi.mock('@/lib/user-admin-server', () => ({
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error.',
  jsonResponse: (payload: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  notAuthenticatedResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), { status: 401 }),
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), { status: 403 }),
}))

const { uploadDeleteHandler } = await import('@/routes/api/uploads.$uploadId')
const { uploadBatchPurgeHandler } =
  await import('@/routes/api/uploads/batches.$batchId.purge')

describe('guarded permanent deletion APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      role: 'editor',
      userId: 'user-1',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires authentication for upload deletion', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadDeleteHandler({
      request: new Request('http://localhost/api/uploads/upload-1', {
        method: 'DELETE',
      }),
      params: { uploadId: 'upload-1' },
    })

    expect(response.status).toBe(401)
    expect(mocks.queueUploadPurge).not.toHaveBeenCalled()
  })

  it('returns 409 with the actionable protection reason', async () => {
    mocks.queueUploadPurge.mockResolvedValue({
      status: 'invalid_state',
      eligibility: {
        canDelete: false,
        code: 'signed',
        reason: 'This certificate has been signed and cannot be deleted.',
      },
    })

    const response = await uploadDeleteHandler({
      request: new Request('http://localhost/api/uploads/upload-1', {
        method: 'DELETE',
      }),
      params: { uploadId: 'upload-1' },
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'This certificate has been signed and cannot be deleted.',
      eligibility: { code: 'signed' },
    })
  })

  it('returns 202 and audits a new upload purge request', async () => {
    mocks.queueUploadPurge.mockResolvedValue({
      status: 'ok',
      targetId: 'upload-1',
      purgeStatus: 'queued',
      alreadyQueued: false,
    })
    const request = new Request('http://localhost/api/uploads/upload-1', {
      method: 'DELETE',
    })

    const response = await uploadDeleteHandler({
      request,
      params: { uploadId: 'upload-1' },
    })

    expect(response.status).toBe(202)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ eventType: 'document_purge_requested' }),
    )
  })

  it('keeps queued upload deletion idempotent without duplicate audit', async () => {
    mocks.queueUploadPurge.mockResolvedValue({
      status: 'ok',
      targetId: 'upload-1',
      purgeStatus: 'running',
      alreadyQueued: true,
    })

    const response = await uploadDeleteHandler({
      request: new Request('http://localhost/api/uploads/upload-1', {
        method: 'DELETE',
      }),
      params: { uploadId: 'upload-1' },
    })

    expect(response.status).toBe(202)
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('requires a Recently Deleted batch before permanent deletion', async () => {
    mocks.queueBatchPurge.mockResolvedValue({
      status: 'invalid_state',
      eligibility: {
        canDelete: false,
        code: 'batch_not_deleted',
        reason: 'Move the batch to Recently Deleted first.',
      },
    })

    const response = await uploadBatchPurgeHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/purge',
        {
          method: 'POST',
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(409)
  })

  it('returns 202 and audits a new batch purge request', async () => {
    mocks.queueBatchPurge.mockResolvedValue({
      status: 'ok',
      targetId: 'batch-1',
      purgeStatus: 'queued',
      alreadyQueued: false,
    })
    const request = new Request(
      'http://localhost/api/uploads/batches/batch-1/purge',
      { method: 'POST' },
    )

    const response = await uploadBatchPurgeHandler({
      request,
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(202)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ eventType: 'batch_purge_requested' }),
    )
  })
})
