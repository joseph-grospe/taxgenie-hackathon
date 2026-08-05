import { beforeEach, describe, expect, it, vi } from 'vitest'

import { importMasterlistHandler } from '@/routes/api/masterlist/import'

const { authorizeSuperAdminRequest, importMasterlistCsvFile, logAuditEvent } =
  vi.hoisted(() => ({
    authorizeSuperAdminRequest: vi.fn(),
    importMasterlistCsvFile: vi.fn(),
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

vi.mock('@/lib/masterlist-server', () => ({
  importMasterlistCsvFile,
}))

const buildRequest = (file?: File) => {
  const formData = new FormData()
  if (file) {
    formData.set('file', file)
  }

  return new Request('http://localhost/api/masterlist/import', {
    method: 'POST',
    body: formData,
  })
}

const readJson = async (response: Response) => response.json()

describe('/api/masterlist/import', () => {
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

    const response = await importMasterlistHandler({ request: buildRequest() })

    expect(response.status).toBe(401)
    expect(importMasterlistCsvFile).not.toHaveBeenCalled()
  })

  it('returns 400 when the file is missing', async () => {
    const response = await importMasterlistHandler({
      request: buildRequest(),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'A CSV file is required.',
    })
  })

  it('returns 400 when the import fails validation', async () => {
    importMasterlistCsvFile.mockRejectedValue(
      new Error('CSV is missing required headers: TIN.'),
    )

    const response = await importMasterlistHandler({
      request: buildRequest(
        new File(['REGION,ENTITY'], 'masterlist.csv', { type: 'text/csv' }),
      ),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'CSV is missing required headers: TIN.',
    })
  })

  it('returns 201 with the inserted count after a successful import', async () => {
    importMasterlistCsvFile.mockResolvedValue({
      insertedCount: 2,
      replaced: true,
      fileName: 'masterlist.csv',
    })

    const response = await importMasterlistHandler({
      request: buildRequest(
        new File(['REGION,ENTITY'], 'masterlist.csv', { type: 'text/csv' }),
      ),
    })

    expect(response.status).toBe(201)
    expect(importMasterlistCsvFile).toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        eventType: 'reference_data_imported',
        actorUserId: 'super-1',
        targetId: 'masterlist',
      }),
    )
    await expect(readJson(response)).resolves.toEqual({
      insertedCount: 2,
      replaced: true,
      fileName: 'masterlist.csv',
    })
  })
})
