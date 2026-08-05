import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportPdf: vi.fn(),
  createCertificateMergeJob: vi.fn(),
  getCertificateMergeJobView: vi.fn(),
  getCertificateMergeOutputDownload: vi.fn(),
  listCertificateMergeBatchOptions: vi.fn(),
  listCertificateMergeEntities: vi.fn(),
  listCertificateMergeJobs: vi.fn(),
  overrideCertificateMergeAssignment: vi.fn(),
  previewCertificateMergeJob: vi.fn(),
  assignmentOverrideSchema: {
    safeParse: (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'packageType' in value &&
        'status' in value
      ) {
        return { success: true, data: value }
      }

      return { success: false }
    },
  },
  requestSchema: {
    safeParse: (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'payeeShortName' in value &&
        'periodType' in value &&
        'year' in value &&
        'batchIds' in value &&
        Array.isArray(value.batchIds) &&
        value.batchIds.length > 0
      ) {
        return { success: true, data: value }
      }

      return { success: false }
    },
  },
  optionsScopeSchema: {
    safeParse: (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'payeeShortName' in value &&
        'periodType' in value &&
        'year' in value
      ) {
        return { success: true, data: value }
      }

      return {
        success: false,
        error: { issues: [{ message: 'Invalid merge options.' }] },
      }
    },
  },
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    pdf: mocks.canExportPdf,
  },
  isAdmin: (role: string) => role === 'super_admin' || role === 'admin',
}))

vi.mock('@/lib/certificate-merge-server', () => ({
  certificateMergeAssignmentOverrideSchema: mocks.assignmentOverrideSchema,
  certificateMergeOptionsScopeSchema: mocks.optionsScopeSchema,
  certificateMergeRequestSchema: mocks.requestSchema,
  createCertificateMergeJob: mocks.createCertificateMergeJob,
  getCertificateMergeJobView: mocks.getCertificateMergeJobView,
  getCertificateMergeOutputDownload: mocks.getCertificateMergeOutputDownload,
  listCertificateMergeBatchOptions: mocks.listCertificateMergeBatchOptions,
  listCertificateMergeEntities: mocks.listCertificateMergeEntities,
  listCertificateMergeJobs: mocks.listCertificateMergeJobs,
  overrideCertificateMergeAssignment: mocks.overrideCertificateMergeAssignment,
  previewCertificateMergeJob: mocks.previewCertificateMergeJob,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message = 'Bad request') =>
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
  notAuthenticatedResponse: (message = 'Authentication is required.') =>
    new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  parseJsonBodyWithDetails: async (
    request: Request,
    schema: {
      safeParse: (value: unknown) => { success: boolean; data?: unknown }
    },
  ) => {
    const parsed = schema.safeParse(await request.json().catch(() => null))

    return parsed.success
      ? { ok: true as const, data: parsed.data }
      : { ok: false as const, error: 'Invalid request body.' }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { mergeJobOptionsHandler } =
  await import('@/routes/api/merge-jobs/options')
const { previewMergeJobHandler } =
  await import('@/routes/api/merge-jobs/preview')
const { createMergeJobHandler, listMergeJobsHandler } =
  await import('@/routes/api/merge-jobs')
const { mergeJobDetailHandler } = await import('@/routes/api/merge-jobs.$jobId')
const { mergeJobOutputDownloadHandler } =
  await import('@/routes/api/merge-jobs.$jobId.outputs.$partNumber')
const { mergeAssignmentOverrideHandler } =
  await import('@/routes/api/certificates.$certificateId.merge-assignment')

const readJson = async (response: Response) => response.json()

const batchId = '11111111-1111-4111-8111-111111111111'

const mergeRequest = {
  payeeShortName: 'TMO',
  periodType: 'quarterly',
  year: 2024,
  quarter: 1,
  batchIds: [batchId],
}

describe('merge jobs API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportPdf: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportPdf.mockReturnValue(true)
  })

  it('blocks users without PDF export access', async () => {
    mocks.canExportPdf.mockReturnValue(false)

    const response = await mergeJobOptionsHandler({
      request: new Request('http://localhost/api/merge-jobs/options'),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export signed PDF merges.',
    })
  })

  it('returns selectable merge entities', async () => {
    mocks.listCertificateMergeEntities.mockResolvedValue([
      { id: 1, shortName: 'TMO', tin: '004760842', hasValidTin: true },
    ])

    const response = await mergeJobOptionsHandler({
      request: new Request('http://localhost/api/merge-jobs/options'),
    })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      entities: [
        { id: 1, shortName: 'TMO', tin: '004760842', hasValidTin: true },
      ],
    })
  })

  it('returns eligible upload batches for a selected merge scope', async () => {
    mocks.listCertificateMergeEntities.mockResolvedValue([
      { id: 1, shortName: 'TMO', tin: '004760842', hasValidTin: true },
    ])
    mocks.listCertificateMergeBatchOptions.mockResolvedValue([
      {
        id: batchId,
        name: 'January closed batch',
        status: 'closed',
        closedAt: '2024-01-31T12:00:00.000Z',
        lastActivityAt: '2024-01-31T12:00:00.000Z',
        createdAt: '2024-01-01T12:00:00.000Z',
        eligibleSignedPdfCount: 3,
      },
    ])

    const response = await mergeJobOptionsHandler({
      request: new Request(
        'http://localhost/api/merge-jobs/options?payeeShortName=TMO&periodType=quarterly&year=2024&quarter=1',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listCertificateMergeBatchOptions).toHaveBeenCalledWith({
      payeeShortName: 'TMO',
      periodType: 'quarterly',
      year: 2024,
      quarter: 1,
    })
    await expect(readJson(response)).resolves.toEqual({
      entities: [
        { id: 1, shortName: 'TMO', tin: '004760842', hasValidTin: true },
      ],
      batches: [
        {
          id: batchId,
          name: 'January closed batch',
          status: 'closed',
          closedAt: '2024-01-31T12:00:00.000Z',
          lastActivityAt: '2024-01-31T12:00:00.000Z',
          createdAt: '2024-01-01T12:00:00.000Z',
          eligibleSignedPdfCount: 3,
        },
      ],
    })
  })

  it('previews merge outputs before submission', async () => {
    mocks.previewCertificateMergeJob.mockResolvedValue({
      totalInputFiles: 3,
      totalSizeBytes: 1200,
      outputCount: 1,
      lateInputCount: 1,
      candidateRows: [
        {
          certificateId: 7,
          fileName: 'late-q1.pdf',
          certificatePeriod: 'Q1 2024',
          assignedPeriod: 'Q2 2024',
          isLate: true,
          assignmentReason: 'late_after_finalized_quarter',
        },
      ],
      parts: [],
    })

    const response = await previewMergeJobHandler({
      request: new Request('http://localhost/api/merge-jobs/preview', {
        method: 'POST',
        body: JSON.stringify(mergeRequest),
      }),
    })

    expect(response.status).toBe(200)
    expect(mocks.previewCertificateMergeJob).toHaveBeenCalledWith(mergeRequest)
    await expect(readJson(response)).resolves.toEqual({
      preview: {
        totalInputFiles: 3,
        totalSizeBytes: 1200,
        outputCount: 1,
        lateInputCount: 1,
        candidateRows: [
          {
            certificateId: 7,
            fileName: 'late-q1.pdf',
            certificatePeriod: 'Q1 2024',
            assignedPeriod: 'Q2 2024',
            isLate: true,
            assignmentReason: 'late_after_finalized_quarter',
          },
        ],
        parts: [],
      },
    })
  })

  it('requires selected upload batches before previewing', async () => {
    const response = await previewMergeJobHandler({
      request: new Request('http://localhost/api/merge-jobs/preview', {
        method: 'POST',
        body: JSON.stringify({
          payeeShortName: 'TMO',
          periodType: 'quarterly',
          year: 2024,
          quarter: 1,
        }),
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.previewCertificateMergeJob).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid request body.',
    })
  })

  it('returns duplicate-period preview errors as bad requests', async () => {
    const message =
      'A merge job already exists for TMO 1Q 2024 (completed). Use the existing job instead of creating a duplicate.'
    mocks.previewCertificateMergeJob.mockRejectedValue(new Error(message))

    const response = await previewMergeJobHandler({
      request: new Request('http://localhost/api/merge-jobs/preview', {
        method: 'POST',
        body: JSON.stringify(mergeRequest),
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: message,
    })
  })

  it('returns selected batch validation errors as bad requests', async () => {
    const message =
      'Every selected upload batch must contain at least one signed 2307 PDF eligible for this merge period.'
    mocks.previewCertificateMergeJob.mockRejectedValue(new Error(message))

    const response = await previewMergeJobHandler({
      request: new Request('http://localhost/api/merge-jobs/preview', {
        method: 'POST',
        body: JSON.stringify(mergeRequest),
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: message,
    })
  })

  it('submits a merge job through AWS Batch', async () => {
    mocks.createCertificateMergeJob.mockResolvedValue({
      id: 'job-1',
      status: 'submitted',
    })

    const response = await createMergeJobHandler({
      request: new Request('http://localhost/api/merge-jobs', {
        method: 'POST',
        body: JSON.stringify(mergeRequest),
      }),
    })

    expect(response.status).toBe(201)
    expect(mocks.createCertificateMergeJob).toHaveBeenCalledWith({
      request: mergeRequest,
      userId: 'user-1',
    })
    await expect(readJson(response)).resolves.toEqual({
      job: { id: 'job-1', status: 'submitted' },
    })
  })

  it('returns duplicate-period submit errors as bad requests', async () => {
    const message =
      'A merge job already exists for TMO 1Q 2024 (processing). Use the existing job instead of creating a duplicate.'
    mocks.createCertificateMergeJob.mockRejectedValue(new Error(message))

    const response = await createMergeJobHandler({
      request: new Request('http://localhost/api/merge-jobs', {
        method: 'POST',
        body: JSON.stringify(mergeRequest),
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: message,
    })
  })

  it('lists and loads merge job status', async () => {
    mocks.listCertificateMergeJobs.mockResolvedValue({
      jobs: [{ id: 'job-1' }],
      summary: {
        totalJobs: 1,
        activeJobs: 1,
        readyDownloads: 0,
      },
    })
    mocks.getCertificateMergeJobView.mockResolvedValue({
      id: 'job-1',
      status: 'running',
    })

    const listResponse = await listMergeJobsHandler({
      request: new Request('http://localhost/api/merge-jobs'),
    })
    const detailResponse = await mergeJobDetailHandler({
      request: new Request('http://localhost/api/merge-jobs/job-1'),
      params: { jobId: 'job-1' },
    })

    expect(listResponse.status).toBe(200)
    expect(detailResponse.status).toBe(200)
    expect(mocks.listCertificateMergeJobs).toHaveBeenCalledWith({
      userId: 'user-1',
      allowAdmin: false,
      view: 'recent',
      page: 1,
      pageSize: 25,
    })
    await expect(readJson(listResponse)).resolves.toEqual({
      jobs: [{ id: 'job-1' }],
      summary: {
        totalJobs: 1,
        activeJobs: 1,
        readyDownloads: 0,
      },
    })
    await expect(readJson(detailResponse)).resolves.toEqual({
      job: { id: 'job-1', status: 'running' },
    })
  })

  it('returns paginated all merge jobs with summary counts', async () => {
    mocks.listCertificateMergeJobs.mockResolvedValue({
      jobs: [{ id: 'job-2' }],
      summary: {
        totalJobs: 26,
        activeJobs: 2,
        readyDownloads: 4,
      },
      pagination: {
        page: 2,
        pageSize: 25,
        totalItems: 26,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    })

    const response = await listMergeJobsHandler({
      request: new Request(
        'http://localhost/api/merge-jobs?view=all&page=2&pageSize=25',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listCertificateMergeJobs).toHaveBeenCalledWith({
      userId: 'user-1',
      allowAdmin: false,
      view: 'all',
      page: 2,
      pageSize: 25,
    })
    await expect(readJson(response)).resolves.toEqual({
      jobs: [{ id: 'job-2' }],
      summary: {
        totalJobs: 26,
        activeJobs: 2,
        readyDownloads: 4,
      },
      pagination: {
        page: 2,
        pageSize: 25,
        totalItems: 26,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    })
  })

  it('blocks all-job history for unauthorized users', async () => {
    mocks.canExportPdf.mockReturnValue(false)

    const response = await listMergeJobsHandler({
      request: new Request('http://localhost/api/merge-jobs?view=all'),
    })

    expect(response.status).toBe(403)
    expect(mocks.listCertificateMergeJobs).not.toHaveBeenCalled()
  })

  it('returns a presigned merged output download URL', async () => {
    mocks.getCertificateMergeOutputDownload.mockResolvedValue({
      url: 'https://example.com/merged.pdf',
      fileName: 'merged.pdf',
      expiresIn: 900,
    })

    const response = await mergeJobOutputDownloadHandler({
      request: new Request('http://localhost/api/merge-jobs/job-1/outputs/1'),
      params: { jobId: 'job-1', partNumber: '1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getCertificateMergeOutputDownload).toHaveBeenCalledWith({
      mergeJobId: 'job-1',
      partNumber: 1,
      userId: 'user-1',
      allowAdmin: false,
    })
    await expect(readJson(response)).resolves.toEqual({
      download: {
        url: 'https://example.com/merged.pdf',
        fileName: 'merged.pdf',
        expiresIn: 900,
      },
    })
  })

  it('updates a certificate merge assignment override', async () => {
    const requestBody = {
      packageType: 'quarterly',
      status: 'assigned',
      assignedYear: 2024,
      assignedQuarter: 2,
    }
    mocks.overrideCertificateMergeAssignment.mockResolvedValue({
      id: 'assignment-1',
      certificateId: 7,
    })

    const response = await mergeAssignmentOverrideHandler({
      request: new Request(
        'http://localhost/api/certificates/7/merge-assignment',
        {
          method: 'PATCH',
          body: JSON.stringify(requestBody),
        },
      ),
      params: { certificateId: '7' },
    })

    expect(response.status).toBe(200)
    expect(mocks.overrideCertificateMergeAssignment).toHaveBeenCalledWith({
      certificateId: 7,
      userId: 'user-1',
      request: requestBody,
    })
    await expect(readJson(response)).resolves.toEqual({
      assignment: {
        id: 'assignment-1',
        certificateId: 7,
      },
    })
  })

  it('returns locked assignment override errors as bad requests', async () => {
    const message = 'The selected merge package is already locked or active.'
    mocks.overrideCertificateMergeAssignment.mockRejectedValue(
      new Error(message),
    )

    const response = await mergeAssignmentOverrideHandler({
      request: new Request(
        'http://localhost/api/certificates/7/merge-assignment',
        {
          method: 'PATCH',
          body: JSON.stringify({
            packageType: 'quarterly',
            status: 'assigned',
            assignedYear: 2024,
            assignedQuarter: 1,
          }),
        },
      ),
      params: { certificateId: '7' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: message,
    })
  })
})
