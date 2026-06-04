import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canSignCertificates: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  SIGNING_TEAM_REQUIRED_MESSAGE:
    'Only Tax Manager Team users can sign certificates.',
  canAccessRoute: mocks.canAccessRoute,
  canSignCertificates: mocks.canSignCertificates,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message = 'Bad request') =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  notAuthenticatedResponse: (message = 'Authentication is required.') =>
    new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { documentSigningContextHandler } =
  await import('@/routes/api/documents.$docId.signing-context')
const { documentSignHandler } =
  await import('@/routes/api/documents.$docId.sign')

const readJson = async (response: Response) => response.json()

describe('legacy document signing API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'editor',
      team: 'tax_manager',
      canExportPdf: false,
      canExportExcel: false,
      mustChangePassword: false,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canSignCertificates.mockImplementation(
      (context: { team?: string } | null | undefined) =>
        context?.team === 'tax_manager',
    )
  })

  it('keeps Tax Manager Team users on the legacy batch-only response', async () => {
    const response = await documentSigningContextHandler({
      request: new Request(
        'http://localhost/api/documents/doc-1/signing-context',
      ),
      params: { docId: 'doc-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error:
        'Certificate signing is available from closed upload batches only.',
    })
  })

  it('rejects context loading for users outside Tax Manager Team', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'editor',
      team: 'tax_team',
      canExportPdf: false,
      canExportExcel: false,
      mustChangePassword: false,
    })

    const response = await documentSigningContextHandler({
      request: new Request(
        'http://localhost/api/documents/doc-1/signing-context',
      ),
      params: { docId: 'doc-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Only Tax Manager Team users can sign certificates.',
    })
  })

  it('rejects signing for users outside Tax Manager Team', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'editor',
      team: 'tax_team',
      canExportPdf: false,
      canExportExcel: false,
      mustChangePassword: false,
    })

    const response = await documentSignHandler({
      request: new Request('http://localhost/api/documents/doc-1/sign', {
        method: 'POST',
      }),
      params: { docId: 'doc-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Only Tax Manager Team users can sign certificates.',
    })
  })
})
