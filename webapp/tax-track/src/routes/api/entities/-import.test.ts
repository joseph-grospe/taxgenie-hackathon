import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importEntitiesCsvFile } = vi.hoisted(() => ({
  importEntitiesCsvFile: vi.fn(),
}))

vi.mock('@/lib/user-admin-server', () => ({
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

import { importEntitiesHandler } from '@/routes/api/entities/import'

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
    await expect(readJson(response)).resolves.toEqual({
      insertedCount: 2,
      replaced: true,
      fileName: 'entities.csv',
    })
  })
})
