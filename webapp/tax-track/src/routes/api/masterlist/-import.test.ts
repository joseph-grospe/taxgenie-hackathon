import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMasterlistCsvFile } = vi.hoisted(() => ({
  importMasterlistCsvFile: vi.fn(),
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

vi.mock('@/lib/masterlist-server', () => ({
  importMasterlistCsvFile,
}))

import { importMasterlistHandler } from '@/routes/api/masterlist/import'

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
    await expect(readJson(response)).resolves.toEqual({
      insertedCount: 2,
      replaced: true,
      fileName: 'masterlist.csv',
    })
  })
})
