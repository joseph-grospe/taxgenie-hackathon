import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeSuperAdminRequest: vi.fn(),
  createReferenceDataRow: vi.fn(),
  deleteReferenceDataRow: vi.fn(),
  getReferenceDataErrorStatus: vi.fn(),
  listReferenceDataRows: vi.fn(),
  logAuditEvent: vi.fn(),
  updateReferenceDataRow: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))

vi.mock('@/lib/reference-data-server', () => ({
  createReferenceDataRow: mocks.createReferenceDataRow,
  deleteReferenceDataRow: mocks.deleteReferenceDataRow,
  getReferenceDataErrorStatus: mocks.getReferenceDataErrorStatus,
  listReferenceDataRows: mocks.listReferenceDataRows,
  updateReferenceDataRow: mocks.updateReferenceDataRow,
}))

vi.mock('@/lib/user-admin-server', () => ({
  authorizeSuperAdminRequest: mocks.authorizeSuperAdminRequest,
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  jsonResponse: (payload: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { createReferenceDataHandler, listReferenceDataHandler } =
  await import('@/routes/api/reference-data.$dataset')
const { deleteReferenceDataHandler, updateReferenceDataHandler } =
  await import('@/routes/api/reference-data.$dataset.$rowId')

const readJson = async (response: Response) => response.json()

describe('reference data API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorizeSuperAdminRequest.mockResolvedValue({
      ok: true,
      context: { userId: 'super-1', role: 'super_admin' },
    })
    mocks.getReferenceDataErrorStatus.mockReturnValue(400)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('rejects callers before listing any data', async () => {
    mocks.authorizeSuperAdminRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
      }),
    })

    const response = await listReferenceDataHandler({
      request: new Request('http://localhost/api/reference-data/masterlist'),
      params: { dataset: 'masterlist' },
    })

    expect(response.status).toBe(403)
    expect(mocks.listReferenceDataRows).not.toHaveBeenCalled()
  })

  it('lists a validated dataset with bounded pagination', async () => {
    mocks.listReferenceDataRows.mockResolvedValue({
      dataset: 'atc-codes',
      rows: [],
      total: 0,
      page: 2,
      pageSize: 100,
      totalPages: 2,
    })

    const response = await listReferenceDataHandler({
      request: new Request(
        'http://localhost/api/reference-data/atc-codes?q=WC&page=2&pageSize=999',
      ),
      params: { dataset: 'atc-codes' },
    })

    expect(response.status).toBe(200)
    expect(mocks.listReferenceDataRows).toHaveBeenCalledWith('atc-codes', {
      q: 'WC',
      page: 2,
      pageSize: 100,
    })
  })

  it('creates a row and records an audit event', async () => {
    mocks.createReferenceDataRow.mockResolvedValue({
      id: 7,
      taxType: 'WE',
      code: 'WC160',
      description: 'Services',
      rate: 0.02,
    })

    const response = await createReferenceDataHandler({
      request: new Request('http://localhost/api/reference-data/atc-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          taxType: 'WE',
          code: 'WC160',
          description: 'Services',
          rate: 0.02,
        }),
      }),
      params: { dataset: 'atc-codes' },
    })

    expect(response.status).toBe(201)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        eventType: 'reference_data_row_created',
        targetId: 'atc-codes:7',
      }),
    )
  })

  it('updates rows by a positive integer ID', async () => {
    mocks.updateReferenceDataRow.mockResolvedValue({
      id: 12,
      shortName: 'TMO',
      companyName: 'Therma Mobile',
      birRegisteredAddress: null,
      zipCode: null,
      tin: '26656611600000',
      emailAddress: null,
      regionEmailAddress: null,
    })

    const response = await updateReferenceDataHandler({
      request: new Request('http://localhost/api/reference-data/entities/12', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shortName: 'TMO' }),
      }),
      params: { dataset: 'entities', rowId: '12' },
    })

    expect(response.status).toBe(200)
    expect(mocks.updateReferenceDataRow).toHaveBeenCalledWith('entities', 12, {
      shortName: 'TMO',
    })
  })

  it('returns conflict responses for referenced entity deletion', async () => {
    mocks.deleteReferenceDataRow.mockRejectedValue(
      new Error('This entity is used and cannot be deleted.'),
    )
    mocks.getReferenceDataErrorStatus.mockReturnValue(409)

    const response = await deleteReferenceDataHandler({
      request: new Request('http://localhost/api/reference-data/entities/12', {
        method: 'DELETE',
      }),
      params: { dataset: 'entities', rowId: '12' },
    })

    expect(response.status).toBe(409)
    await expect(readJson(response)).resolves.toEqual({
      error: 'This entity is used and cannot be deleted.',
    })
  })
})
