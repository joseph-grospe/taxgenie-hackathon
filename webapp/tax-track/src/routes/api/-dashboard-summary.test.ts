import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  getDashboardSummary: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/dashboard-server', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
}))

vi.mock('@/lib/user-admin-server', () => ({
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
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { dashboardSummaryHandler } =
  await import('@/routes/api/dashboard/summary')

const readJson = async (response: Response) => response.json()

describe('/api/dashboard/summary GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.getDashboardSummary.mockResolvedValue({
      generatedAt: '2026-05-05T00:00:00.000Z',
      period: {
        periodType: 'yearly',
        period: '2026',
        label: '2026',
        startDate: '2025-12-31T16:00:00.000Z',
        endDate: '2026-12-31T16:00:00.000Z',
      },
      trendGroup: 'monthly',
      processedTotal: 0,
      metricGroups: [],
      collectionSummary: {
        collectedCount: 0,
        collectedAmount: 0,
        collectedAmountLabel: 'PHP 0.00',
        uncollectedCount: 0,
        uncollectedAmount: 0,
        uncollectedAmountLabel: 'PHP 0.00',
        totalAmount: 0,
        totalAmountLabel: 'PHP 0.00',
        collectionRate: 0,
        collectionRateLabel: '0%',
      },
      metrics: [],
      trend: [],
      recentBatches: [],
      validatedDocuments: [],
      filterOptions: {
        recentBatches: {
          statuses: [
            'Open',
            'Uploaded',
            'Processing',
            'Needs review',
            'Validated',
          ],
        },
        validatedDocuments: {
          statuses: ['Ready', 'Duplicate', 'Error'],
          atc: [],
        },
      },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await dashboardSummaryHandler({
      request: new Request('http://localhost/api/dashboard/summary'),
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to view dashboard analytics.',
    })
  })

  it('returns 403 when dashboard access is denied', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await dashboardSummaryHandler({
      request: new Request('http://localhost/api/dashboard/summary'),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view dashboard analytics.',
    })
  })

  it('passes period filters to the dashboard service', async () => {
    const response = await dashboardSummaryHandler({
      request: new Request(
        'http://localhost/api/dashboard/summary?periodType=monthly&period=2026-05',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.getDashboardSummary).toHaveBeenCalledWith({
      periodType: 'monthly',
      period: '2026-05',
      trendGroup: null,
      entityId: null,
    })
  })

  it('passes trend grouping to the dashboard service', async () => {
    const response = await dashboardSummaryHandler({
      request: new Request(
        'http://localhost/api/dashboard/summary?periodType=yearly&period=2026&trendGroup=weekly',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.getDashboardSummary).toHaveBeenCalledWith({
      periodType: 'yearly',
      period: '2026',
      trendGroup: 'weekly',
      entityId: null,
    })
  })

  it('passes entity filter to the dashboard service', async () => {
    const response = await dashboardSummaryHandler({
      request: new Request(
        'http://localhost/api/dashboard/summary?periodType=yearly&period=2026&entityId=12',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.getDashboardSummary).toHaveBeenCalledWith({
      periodType: 'yearly',
      period: '2026',
      trendGroup: null,
      entityId: '12',
    })
  })

  it('returns 400 for invalid period filters', async () => {
    mocks.getDashboardSummary.mockRejectedValue(
      new Error('Invalid dashboard period value.'),
    )

    const response = await dashboardSummaryHandler({
      request: new Request(
        'http://localhost/api/dashboard/summary?periodType=monthly&period=2026-13',
      ),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid dashboard period value.',
    })
  })
})
