import { beforeEach, describe, expect, it, vi } from 'vitest'

import { importEntitiesHandler } from '@/routes/api/entities/import'

const { authorizeSuperAdminRequest, importEntitiesCsvFile, logAuditEvent } =
  vi.hoisted(() => ({
    authorizeSuperAdminRequest: vi.fn(),
    importEntitiesCsvFile: vi.fn(),
    logAuditEvent: vi.fn(),
  }))

vi.mock('@/lib/audit', () => ({ logAuditEvent }))

vi.mock('@/lib/user-admin-server', () => ({
  authorizeSuperAdminRequest,
  badRequestResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  jsonResponse: (payload: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/lib/entities-server', () => ({
  importEntitiesCsvFile,
}))

const buildRequest = (file?: File) => {
  const formData = new FormData()
  if (file) {
    formData.set('file', file)
  }

  return new Request('http://localhost/api/entities/import', {
    method: 'POST',
    body: formData,
  })
}

const readJson = async (response: Response) => response.json()

describe('/api/entities/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeSuperAdminRequest.mockResolvedValue({
      ok: true,
      context: { userId: 'super-1', role: 'super_admin' },
    })
    logAuditEvent.mockResolvedValue(undefined)
  })

  it('rejects unauthenticated callers before importing', async () => {
    authorizeSuperAdminRequest.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Authentication is required.' }),
        {
          status: 401,
        },
      ),
    })

    const response = await importEntitiesHandler({ request: buildRequest() })

    expect(response.status).toBe(401)
    expect(importEntitiesCsvFile).not.toHaveBeenCalled()
  })

  it('returns 400 when the file is missing', async () => {
    const response = await importEntitiesHandler({
      request: buildRequest(),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'A CSV file is required.',
    })
  })

  it('returns 400 when the import fails validation', async () => {
    importEntitiesCsvFile.mockRejectedValue(
      new Error('CSV is missing required headers: REGION.'),
    )

    const response = await importEntitiesHandler({
      request: buildRequest(
        new File(['Short Name,Company Name'], 'entities.csv', {
          type: 'text/csv',
        }),
      ),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'CSV is missing required headers: REGION.',
    })
  })

  it('returns 201 with the inserted count after a successful import', async () => {
    importEntitiesCsvFile.mockResolvedValue({
      insertedCount: 2,
      replaced: true,
      fileName: 'entities.csv',
    })

    const response = await importEntitiesHandler({
      request: buildRequest(
        new File(['Short Name,Company Name'], 'entities.csv', {
          type: 'text/csv',
        }),
      ),
    })

    expect(response.status).toBe(201)
    expect(importEntitiesCsvFile).toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ targetId: 'entities' }),
    )
    await expect(readJson(response)).resolves.toEqual({
      insertedCount: 2,
      replaced: true,
      fileName: 'entities.csv',
    })
  })
})
