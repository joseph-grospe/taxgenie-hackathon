import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  closeActiveUploadBatch: vi.fn(),
  closeUploadBatch: vi.fn(),
  deleteUploadBatch: vi.fn(),
  getUploadBatchById: vi.fn(),
  listUploadBatchFiles: vi.fn(),
  listUploadBatches: vi.fn(),
  listRecentUploads: vi.fn(),
  logAuditEvent: vi.fn(),
  parseEntityFilterIdInput: vi.fn(),
  renameUploadBatch: vi.fn(),
  reopenUploadBatch: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  restoreUploadBatch: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/intake-server', () => ({
  closeActiveUploadBatch: mocks.closeActiveUploadBatch,
  closeUploadBatch: mocks.closeUploadBatch,
  closeUploadBatchSchema: {
    safeParse: (body: unknown) => {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return {
          success: false,
          error: { issues: [{ message: 'Invalid request payload.' }] },
        }
      }

      const batchId = (body as { batchId?: unknown }).batchId
      if (batchId !== undefined && typeof batchId !== 'string') {
        return {
          success: false,
          error: { issues: [{ message: 'Invalid request payload.' }] },
        }
      }

      return { success: true, data: { batchId } }
    },
  },
  deleteUploadBatch: mocks.deleteUploadBatch,
  getUploadBatchById: mocks.getUploadBatchById,
  listUploadBatchFiles: mocks.listUploadBatchFiles,
  listUploadBatches: mocks.listUploadBatches,
  listRecentUploads: mocks.listRecentUploads,
  renameUploadBatch: mocks.renameUploadBatch,
  reopenUploadBatch: mocks.reopenUploadBatch,
  restoreUploadBatch: mocks.restoreUploadBatch,
  reopenUploadBatchSchema: {
    safeParse: (body: unknown) => {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return {
          success: false,
          error: { issues: [{ message: 'Invalid request payload.' }] },
        }
      }

      return { success: true, data: {} }
    },
  },
  renameUploadBatchSchema: {
    safeParse: (body: unknown) => {
      if (typeof body !== 'object' || body === null || !('name' in body)) {
        return {
          success: false,
          error: { issues: [{ message: 'Invalid request payload.' }] },
        }
      }

      const name = (body as { name: unknown }).name
      if (name !== null && typeof name !== 'string') {
        return {
          success: false,
          error: { issues: [{ message: 'Invalid request payload.' }] },
        }
      }

      const normalizedName = name === null ? null : name.trim() || null
      if (normalizedName && normalizedName.length > 80) {
        return {
          success: false,
          error: {
            issues: [{ message: 'Batch name must be 80 characters or fewer.' }],
          },
        }
      }

      return { success: true, data: { name: normalizedName } }
    },
  },
}))

vi.mock('@/lib/entities-server', () => ({
  parseEntityFilterIdInput: mocks.parseEntityFilterIdInput,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error.',
  jsonResponse: (payload: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  notAuthenticatedResponse: (message = 'Authentication is required.') =>
    new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  parseJsonBodyWithDetails: async (
    request: Request,
    schema: { safeParse: (body: unknown) => unknown },
  ) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return { ok: false, error: 'Invalid JSON payload.' }
    }

    const parsed = schema.safeParse(body) as
      | { success: true; data: unknown }
      | { success: false; error: { issues: Array<{ message?: string }> } }
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid request payload.',
      }
    }

    return { ok: true, data: parsed.data }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const {
  uploadBatchDeleteHandler,
  uploadBatchDetailHandler,
  uploadBatchRenameHandler,
} = await import('@/routes/api/uploads/batches.$batchId')
const { uploadBatchActiveCloseHandler } =
  await import('@/routes/api/uploads/batches/active/close')
const { uploadBatchesListHandler } =
  await import('@/routes/api/uploads/batches')
const { uploadRecentHandler } = await import('@/routes/api/uploads/recent')
const { uploadBatchFilesHandler } =
  await import('@/routes/api/uploads/batches.$batchId.files')
const { uploadBatchReopenHandler } =
  await import('@/routes/api/uploads/batches.$batchId.reopen')
const { uploadBatchRestoreHandler } =
  await import('@/routes/api/uploads/batches.$batchId.restore')

const readJson = async (response: Response) => response.json()

const buildBatch = (overrides: Record<string, unknown> = {}) => ({
  id: 'batch-1',
  name: null,
  filesMode: 'summary',
  entity: null,
  createdByUserId: 'user-1',
  status: 'open',
  overallStatus: 'processing',
  canSignBatch: false,
  batchSigningStatus: 'unavailable',
  totalFiles: 2,
  openAttentionCount: 1,
  counts: {
    pending: 0,
    uploaded: 0,
    queued: 1,
    processing: 1,
    success: 0,
    duplicate: 0,
    error: 0,
  },
  lastActivityAt: '2026-04-25T10:00:00.000Z',
  closedAt: null,
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt: '2026-04-25T09:00:00.000Z',
  updatedAt: '2026-04-25T10:00:00.000Z',
  files: [],
  ...overrides,
})

describe('/api/uploads/recent GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
  })

  it('returns a summary-first active batch payload with a bounded preview', async () => {
    const previewFiles = Array.from({ length: 25 }, (_item, index) => ({
      id: `upload-${index}`,
      fileName: `file-${index}.pdf`,
    }))
    mocks.listRecentUploads.mockResolvedValue({
      activeBatch: buildBatch({
        filesMode: 'preview',
        totalFiles: 1_000,
        openAttentionCount: 17,
        files: previewFiles,
      }),
      recentBatches: [
        buildBatch({
          id: 'batch-closed',
          filesMode: 'summary',
          totalFiles: 1_000,
          files: [],
        }),
      ],
      summary: {
        pending: 10,
        uploaded: 20,
        queued: 30,
        processing: 40,
        success: 883,
        duplicate: 12,
        error: 5,
      },
    })

    const response = await uploadRecentHandler({
      request: new Request('http://localhost/api/uploads/recent'),
    })

    expect(response.status).toBe(200)
    const payload = await readJson(response)
    expect(payload.activeBatch.filesMode).toBe('preview')
    expect(payload.activeBatch.totalFiles).toBe(1_000)
    expect(payload.activeBatch.openAttentionCount).toBe(17)
    expect(payload.activeBatch.files).toHaveLength(25)
    expect(payload.recentBatches[0].filesMode).toBe('summary')
    expect(payload.recentBatches[0].files).toEqual([])
    expect(payload.summary.success).toBe(883)
  })
})

describe('/api/uploads/batches/$batchId GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
  })

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchDetailHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1'),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to view upload batches.',
    })
  })

  it('returns 403 when the user cannot access batch routes', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchDetailHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1'),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view batches.',
    })
  })

  it('returns 404 when the batch does not exist', async () => {
    mocks.getUploadBatchById.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await uploadBatchDetailHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1'),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.canAccessRoute).toHaveBeenCalledWith('batches', 'editor')
    expect(mocks.getUploadBatchById).toHaveBeenCalledWith({
      batchId: 'batch-1',
    })
    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })

  it('returns the batch detail payload for any authenticated role with batches access', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'viewer-1',
      role: 'viewer',
    })
    mocks.getUploadBatchById.mockResolvedValue({
      status: 'ok',
      batch: buildBatch(),
    })

    const response = await uploadBatchDetailHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1'),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('batches', 'viewer')
    await expect(readJson(response)).resolves.toEqual({
      batch: expect.objectContaining({
        id: 'batch-1',
        totalFiles: 2,
      }),
    })
  })
})

describe('/api/uploads/batches GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'viewer-1',
      role: 'viewer',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.parseEntityFilterIdInput.mockReturnValue(null)
    mocks.listUploadBatches.mockResolvedValue({
      batches: [{ id: 'batch-1', ownerName: 'Ada Admin' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        total: 1,
        active: 1,
        needsReview: 0,
        completed: 0,
      },
      filterOptions: {
        statuses: ['Active'],
        signingStatuses: ['unavailable'],
      },
    })
  })

  it('requires authentication before listing batches', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchesListHandler({
      request: new Request('http://localhost/api/uploads/batches'),
    })

    expect(response.status).toBe(401)
    expect(mocks.listUploadBatches).not.toHaveBeenCalled()
  })

  it('requires batches route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchesListHandler({
      request: new Request('http://localhost/api/uploads/batches'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('batches', 'viewer')
    expect(mocks.listUploadBatches).not.toHaveBeenCalled()
  })

  it('parses filters and pagination before calling the service', async () => {
    const response = await uploadBatchesListHandler({
      request: new Request(
        'http://localhost/api/uploads/batches?q=april&status=Needs%20Review&entity=AESI&signingStatus=partial&attention=needs_attention&page=-5&pageSize=999',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listUploadBatches).toHaveBeenCalledWith({
      q: 'april',
      status: 'Needs Review',
      entity: 'AESI',
      entityId: '',
      repository: 'active',
      signingStatus: 'partial',
      attention: 'needs_attention',
      page: 1,
      pageSize: 25,
    })
    await expect(readJson(response)).resolves.toEqual({
      batches: [{ id: 'batch-1', ownerName: 'Ada Admin' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        total: 1,
        active: 1,
        needsReview: 0,
        completed: 0,
      },
      filterOptions: {
        statuses: ['Active'],
        signingStatuses: ['unavailable'],
      },
    })
  })

  it('passes entity id filters and lets entity id win over legacy entity text', async () => {
    const response = await uploadBatchesListHandler({
      request: new Request(
        'http://localhost/api/uploads/batches?entity=AESI&entityId=12&page=2',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.parseEntityFilterIdInput).toHaveBeenCalledWith('12')
    expect(mocks.listUploadBatches).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: '',
        entityId: '12',
        repository: 'active',
        page: 2,
      }),
    )
  })

  it('passes Recently Deleted view filters to the service', async () => {
    const response = await uploadBatchesListHandler({
      request: new Request(
        'http://localhost/api/uploads/batches?view=recentlyDeleted&page=2',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listUploadBatches).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'deleted',
        page: 2,
      }),
    )
  })

  it('keeps legacy repository filters working for list calls', async () => {
    const response = await uploadBatchesListHandler({
      request: new Request(
        'http://localhost/api/uploads/batches?repository=deleted&page=2',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listUploadBatches).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'deleted',
        page: 2,
      }),
    )
  })

  it('returns 400 for invalid direct entity id filters', async () => {
    mocks.parseEntityFilterIdInput.mockImplementation(() => {
      throw new Error('Invalid entity filter.')
    })

    const response = await uploadBatchesListHandler({
      request: new Request('http://localhost/api/uploads/batches?entityId=bad'),
    })

    expect(response.status).toBe(400)
    expect(mocks.listUploadBatches).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid entity filter.',
    })
  })
})

describe('/api/uploads/batches/$batchId/files GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'viewer-1',
      role: 'viewer',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.listUploadBatchFiles.mockResolvedValue({
      status: 'ok',
      result: {
        files: [{ id: 'upload-1', fileName: 'sample.pdf' }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        filterOptions: {
          statuses: ['success'],
        },
      },
    })
  })

  it('requires authentication before listing batch files', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchFilesHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/files',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    expect(mocks.listUploadBatchFiles).not.toHaveBeenCalled()
  })

  it('requires batches route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchFilesHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/files',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('batches', 'viewer')
    expect(mocks.listUploadBatchFiles).not.toHaveBeenCalled()
  })

  it('parses filters and pagination before calling the service', async () => {
    const response = await uploadBatchFilesHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/files?q=invoice&status=duplicate&attention=open&page=-3&pageSize=999',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.listUploadBatchFiles).toHaveBeenCalledWith({
      batchId: 'batch-1',
      q: 'invoice',
      status: 'duplicate',
      attention: 'open',
      page: 1,
      pageSize: 25,
    })
    await expect(readJson(response)).resolves.toEqual({
      files: [{ id: 'upload-1', fileName: 'sample.pdf' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      filterOptions: {
        statuses: ['success'],
      },
    })
  })

  it('returns 404 when the batch is missing', async () => {
    mocks.listUploadBatchFiles.mockResolvedValue({
      status: 'not_found',
      result: null,
    })

    const response = await uploadBatchFilesHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/files',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })
})

describe('/api/uploads/batches/active/close POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.closeActiveUploadBatch.mockResolvedValue(
      buildBatch({ status: 'closed' }),
    )
    mocks.closeUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({ status: 'closed' }),
    })
  })

  it('returns 401 when the close request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchActiveCloseHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/active/close',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to close upload batches.',
    })
  })

  it('returns 403 when the user cannot close upload batches', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchActiveCloseHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/active/close',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to close upload batches.',
    })
  })

  it('keeps the active-batch close path for empty payloads', async () => {
    const response = await uploadBatchActiveCloseHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/active/close',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.closeActiveUploadBatch).toHaveBeenCalledWith({
      userId: 'user-1',
    })
    expect(mocks.closeUploadBatch).not.toHaveBeenCalled()
  })

  it('owner-scopes batch-specific close requests', async () => {
    const response = await uploadBatchActiveCloseHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/active/close',
        {
          method: 'POST',
          body: JSON.stringify({ batchId: 'batch-1' }),
        },
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.closeUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      userId: 'user-1',
    })
    expect(mocks.closeActiveUploadBatch).not.toHaveBeenCalled()
  })

  it('returns 403 when closing another user batch', async () => {
    mocks.closeUploadBatch.mockResolvedValue({
      status: 'forbidden',
      batch: null,
    })

    const response = await uploadBatchActiveCloseHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/active/close',
        {
          method: 'POST',
          body: JSON.stringify({ batchId: 'batch-1' }),
        },
      ),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to close this upload batch.',
    })
  })

  it('returns 404 when closing a missing batch', async () => {
    mocks.closeUploadBatch.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await uploadBatchActiveCloseHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/active/close',
        {
          method: 'POST',
          body: JSON.stringify({ batchId: 'batch-1' }),
        },
      ),
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })
})

describe('/api/uploads/batches/$batchId/reopen POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
  })

  it('returns 401 when the reopen request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchReopenHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/reopen',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to re-open upload batches.',
    })
  })

  it('returns 403 when the user cannot reopen upload batches', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchReopenHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/reopen',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to re-open upload batches.',
    })
  })

  it('returns 404 when reopening a missing batch', async () => {
    mocks.reopenUploadBatch.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await uploadBatchReopenHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/reopen',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.reopenUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      userId: 'user-1',
    })
    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })

  it('returns 403 when reopening another user batch', async () => {
    mocks.reopenUploadBatch.mockResolvedValue({
      status: 'forbidden',
      batch: null,
    })

    const response = await uploadBatchReopenHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/reopen',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to re-open this upload batch.',
    })
  })

  it('returns the owned batch after reopening it', async () => {
    mocks.reopenUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({ status: 'open', closedAt: null }),
    })

    const response = await uploadBatchReopenHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/reopen',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      batch: expect.objectContaining({
        id: 'batch-1',
        status: 'open',
      }),
    })
  })

  it('returns 400 when another open batch blocks reopening', async () => {
    mocks.reopenUploadBatch.mockRejectedValue(
      new Error(
        'Close your current open upload batch before re-opening this batch.',
      ),
    )

    const response = await uploadBatchReopenHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/reopen',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error:
        'Close your current open upload batch before re-opening this batch.',
    })
  })
})

describe('/api/uploads/batches/$batchId DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('returns 401 when the delete request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchDeleteHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'DELETE',
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    expect(mocks.deleteUploadBatch).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to delete upload batches.',
    })
  })

  it('returns 403 when the user cannot delete upload batches', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchDeleteHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'DELETE',
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('upload', 'editor')
    expect(mocks.deleteUploadBatch).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to delete upload batches.',
    })
  })

  it('returns 404 when deleting a missing batch', async () => {
    mocks.deleteUploadBatch.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await uploadBatchDeleteHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'DELETE',
      }),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.deleteUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      userId: 'user-1',
    })
    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })

  it('rejects open batches', async () => {
    mocks.deleteUploadBatch.mockResolvedValue({
      status: 'invalid_state',
      batch: buildBatch({ status: 'open', closedAt: null }),
    })

    const response = await uploadBatchDeleteHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'DELETE',
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Only closed upload batches can be deleted.',
    })
  })

  it('soft-deletes closed batches and logs an audit event', async () => {
    mocks.deleteUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({
        status: 'closed',
        deletedAt: '2026-05-01T10:00:00.000Z',
        deletedByUserId: 'user-1',
        purgeAfterAt: '2026-05-31T10:00:00.000Z',
      }),
    })

    const request = new Request(
      'http://localhost/api/uploads/batches/batch-1',
      {
        method: 'DELETE',
      },
    )
    const response = await uploadBatchDeleteHandler({
      request,
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'batch_deleted',
        actorUserId: 'user-1',
        targetId: 'batch-1',
        targetType: 'batch',
      }),
    )
    await expect(readJson(response)).resolves.toEqual({
      deleted: true,
      batch: expect.objectContaining({
        id: 'batch-1',
        deletedAt: '2026-05-01T10:00:00.000Z',
        purgeAfterAt: '2026-05-31T10:00:00.000Z',
      }),
    })
  })
})

describe('/api/uploads/batches/$batchId/restore POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('returns 401 when the restore request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchRestoreHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/restore',
        {
          method: 'POST',
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    expect(mocks.restoreUploadBatch).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to restore upload batches.',
    })
  })

  it('returns 403 when the user cannot restore upload batches', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchRestoreHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/restore',
        {
          method: 'POST',
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('upload', 'editor')
    expect(mocks.restoreUploadBatch).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to restore upload batches.',
    })
  })

  it('returns 404 when restoring a missing batch', async () => {
    mocks.restoreUploadBatch.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await uploadBatchRestoreHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/restore',
        {
          method: 'POST',
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.restoreUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      userId: 'user-1',
    })
    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })

  it('rejects batches past their retention window', async () => {
    mocks.restoreUploadBatch.mockResolvedValue({
      status: 'expired',
      batch: buildBatch({
        status: 'closed',
        deletedAt: '2026-05-01T10:00:00.000Z',
        purgeAfterAt: '2026-05-31T10:00:00.000Z',
      }),
    })

    const response = await uploadBatchRestoreHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/restore',
        {
          method: 'POST',
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error:
        'This upload batch can no longer be restored because its Recently Deleted retention window has passed.',
    })
  })

  it('restores deleted batches and logs an audit event', async () => {
    mocks.restoreUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({ status: 'closed' }),
    })

    const request = new Request(
      'http://localhost/api/uploads/batches/batch-1/restore',
      {
        method: 'POST',
      },
    )
    const response = await uploadBatchRestoreHandler({
      request,
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'batch_restored',
        actorUserId: 'user-1',
        targetId: 'batch-1',
        targetType: 'batch',
      }),
    )
    await expect(readJson(response)).resolves.toEqual({
      restored: true,
      batch: expect.objectContaining({
        id: 'batch-1',
        deletedAt: null,
        purgeAfterAt: null,
      }),
    })
  })
})

describe('/api/uploads/batches/$batchId PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
  })

  it('returns 401 when the rename request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'April batch' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to rename upload batches.',
    })
  })

  it('returns 403 when the user cannot rename upload batches', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'April batch' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to rename upload batches.',
    })
  })

  it('returns 404 when renaming a missing batch', async () => {
    mocks.renameUploadBatch.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'April batch' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.renameUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      name: 'April batch',
    })
    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })

  it('returns 403 when the rename service forbids the batch', async () => {
    mocks.renameUploadBatch.mockResolvedValue({
      status: 'forbidden',
      batch: null,
    })

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'April batch' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to rename this upload batch.',
    })
  })

  it('does not owner-scope rename requests for permitted upload users', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'other-user-1',
      role: 'editor',
    })
    mocks.renameUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({ name: 'April batch', createdByUserId: 'user-1' }),
    })

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'April batch' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.renameUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      name: 'April batch',
    })
  })

  it('trims and saves a valid batch name', async () => {
    mocks.renameUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({ name: 'April batch' }),
    })

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: '  April batch  ' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.renameUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      name: 'April batch',
    })
    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      batch: expect.objectContaining({
        id: 'batch-1',
        name: 'April batch',
      }),
    })
  })

  it('clears the batch name when the payload is blank', async () => {
    mocks.renameUploadBatch.mockResolvedValue({
      status: 'ok',
      batch: buildBatch({ name: null }),
    })

    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: '   ' }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.renameUploadBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      name: null,
    })
    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      batch: expect.objectContaining({
        id: 'batch-1',
        name: null,
      }),
    })
  })

  it('rejects names longer than 80 characters', async () => {
    const response = await uploadBatchRenameHandler({
      request: new Request('http://localhost/api/uploads/batches/batch-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'A'.repeat(81) }),
      }),
      params: { batchId: 'batch-1' },
    })

    expect(mocks.renameUploadBatch).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Batch name must be 80 characters or fewer.',
    })
  })
})
