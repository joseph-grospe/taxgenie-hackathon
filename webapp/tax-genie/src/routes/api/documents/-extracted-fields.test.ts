import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DocumentsServer from '@/lib/documents-server'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  updateDocumentExtractedFields: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/documents-server', async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentsServer>()

  return {
    ...actual,
    updateDocumentExtractedFields: mocks.updateDocumentExtractedFields,
  }
})

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
    schema: { safeParse: (value: unknown) => unknown },
  ) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return { ok: false, error: 'Invalid JSON payload.' }
    }

    const parsed = schema.safeParse(body) as
      | { success: true; data: unknown }
      | { success: false; error: { issues: Array<{ message: string }> } }

    return parsed.success
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          error: parsed.error.issues[0]?.message ?? 'Invalid payload.',
        }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { updateDocumentExtractedFieldsHandler } =
  await import('@/routes/api/documents.$docId.extracted-fields')

const readJson = async (response: Response) => response.json()

const createRequest = (body: unknown) =>
  new Request('http://localhost/api/documents/42/extracted-fields', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('/api/documents/$docId/extracted-fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'editor-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.updateDocumentExtractedFields.mockResolvedValue({
      id: '42',
      payorName: 'Updated Customer',
    })
  })

  it('requires authentication before updating extracted fields', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await updateDocumentExtractedFieldsHandler({
      request: createRequest({ payorName: 'Updated Customer' }),
      params: { docId: '42' },
    })

    expect(response.status).toBe(401)
    expect(mocks.updateDocumentExtractedFields).not.toHaveBeenCalled()
  })

  it('requires validated route access before updating extracted fields', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const noAccessResponse = await updateDocumentExtractedFieldsHandler({
      request: createRequest({ payorName: 'Updated Customer' }),
      params: { docId: '42' },
    })

    expect(noAccessResponse.status).toBe(403)
    expect(mocks.updateDocumentExtractedFields).not.toHaveBeenCalled()
  })

  it('validates extracted field payloads', async () => {
    const response = await updateDocumentExtractedFieldsHandler({
      request: createRequest({ unknownField: 'Updated Customer' }),
      params: { docId: '42' },
    })

    expect(response.status).toBe(400)
    expect(mocks.updateDocumentExtractedFields).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Unknown extracted field: unknownField.',
    })
  })

  it('rejects invalid month of quarter payload values', async () => {
    const response = await updateDocumentExtractedFieldsHandler({
      request: createRequest({ monthOfQuarter: 'fourth' }),
      params: { docId: '42' },
    })

    expect(response.status).toBe(400)
    expect(mocks.updateDocumentExtractedFields).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Month of quarter must be first, second, or third.',
    })
  })

  it('returns service permission failures as unauthorized responses', async () => {
    mocks.updateDocumentExtractedFields.mockRejectedValue(
      new Error('You do not have permission to update extracted fields.'),
    )

    const permissionResponse = await updateDocumentExtractedFieldsHandler({
      request: createRequest({ payorName: 'Updated Customer' }),
      params: { docId: '42' },
    })

    expect(permissionResponse.status).toBe(403)
    await expect(readJson(permissionResponse)).resolves.toEqual({
      error: 'You do not have permission to update extracted fields.',
    })
  })

  it('returns service failures such as signed certificates as bad requests', async () => {
    mocks.updateDocumentExtractedFields.mockRejectedValue(
      new Error('Signed certificates cannot be edited.'),
    )

    const signedResponse = await updateDocumentExtractedFieldsHandler({
      request: createRequest({ payorName: 'Updated Customer' }),
      params: { docId: '42' },
    })

    expect(signedResponse.status).toBe(400)
    await expect(readJson(signedResponse)).resolves.toEqual({
      error: 'Signed certificates cannot be edited.',
    })
  })

  it('updates extracted fields and returns the refreshed document', async () => {
    const response = await updateDocumentExtractedFieldsHandler({
      request: createRequest({
        periodStart: '2025-09-01',
        monthOfQuarter: 'third',
        payorName: 'Updated Customer',
        taxWithheld: '1,250.50',
      }),
      params: { docId: '42' },
    })

    expect(response.status).toBe(200)
    expect(mocks.updateDocumentExtractedFields).toHaveBeenCalledWith({
      documentId: '42',
      actor: {
        role: 'editor',
        userId: 'editor-1',
      },
      fields: {
        periodStart: '2025-09-01',
        monthOfQuarter: 'third',
        payorName: 'Updated Customer',
        taxWithheld: '1,250.50',
      },
    })
    await expect(readJson(response)).resolves.toEqual({
      document: {
        id: '42',
        payorName: 'Updated Customer',
      },
    })
  })
})
