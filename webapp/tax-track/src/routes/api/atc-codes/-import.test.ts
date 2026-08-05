import { beforeEach, describe, expect, it, vi } from 'vitest'

import { importAtcCodesHandler } from '@/routes/api/atc-codes/import'

const { authorizeSuperAdminRequest, importAtcCodesCsvFile, logAuditEvent } =
  vi.hoisted(() => ({
    authorizeSuperAdminRequest: vi.fn(),
    importAtcCodesCsvFile: vi.fn(),
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

vi.mock('@/lib/atc-codes-server', () => ({
  importAtcCodesCsvFile,
}))

const buildRequest = (file?: File) => {
  const formData = new FormData()
  if (file) {
    formData.set('file', file)
  }

  return new Request('http://localhost/api/atc-codes/import', {
    method: 'POST',
    body: formData,
  })
}

const readJson = async (response: Response) => response.json()

describe('/api/atc-codes/import', () => {
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

    const response = await importAtcCodesHandler({ request: buildRequest() })

    expect(response.status).toBe(401)
    expect(importAtcCodesCsvFile).not.toHaveBeenCalled()
  })

  it('returns 400 when the file is missing', async () => {
    const response = await importAtcCodesHandler({
      request: buildRequest(),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'A CSV file is required.',
    })
  })

  it('returns 400 when the import fails validation', async () => {
    importAtcCodesCsvFile.mockRejectedValue(
      new Error('CSV is missing required headers: Tax Rate.'),
    )

    const response = await importAtcCodesHandler({
      request: buildRequest(
        new File(['Tax Type,ATC,Description'], 'atc-codes.csv', {
          type: 'text/csv',
        }),
      ),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'CSV is missing required headers: Tax Rate.',
    })
  })

  it('returns 201 with the inserted count after a successful import', async () => {
    importAtcCodesCsvFile.mockResolvedValue({
      insertedCount: 7,
      replaced: true,
      fileName: 'ATCs.xlsx - ATC Codes.csv',
    })

    const response = await importAtcCodesHandler({
      request: buildRequest(
        new File(['Tax Type,ATC,Description,Tax Rate'], 'atc-codes.csv', {
          type: 'text/csv',
        }),
      ),
    })

    expect(response.status).toBe(201)
    expect(importAtcCodesCsvFile).toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ targetId: 'atc-codes' }),
    )
    await expect(readJson(response)).resolves.toEqual({
      insertedCount: 7,
      replaced: true,
      fileName: 'ATCs.xlsx - ATC Codes.csv',
    })
  })
})
