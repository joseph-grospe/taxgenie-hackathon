import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import {
  certificateMergeOptionsScopeSchema,
  listCertificateMergeBatchOptions,
  listCertificateMergeEntities,
} from '@/lib/certificate-merge-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const MERGE_SCOPE_QUERY_KEYS = [
  'payeeShortName',
  'periodType',
  'year',
  'quarter',
] as const

const parseOptionalInt = (value: string | null) => {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export const mergeJobOptionsHandler = async ({
  request,
}: {
  request: Request
}) => {
  if (!isFeatureEnabled('merge')) return featureDisabledResponse('merge')

  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to merge signed PDFs.',
    )
  }

  if (!canAccessRoute('reports', context.role)) {
    return unauthorizedResponse('You do not have permission to view reports.')
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return unauthorizedResponse(
      'You do not have permission to export signed PDF merges.',
    )
  }

  const url = new URL(request.url)
  const entities = await listCertificateMergeEntities()
  const hasScopeQuery = MERGE_SCOPE_QUERY_KEYS.some((key) =>
    url.searchParams.has(key),
  )

  if (!hasScopeQuery) {
    return jsonResponse({ entities })
  }

  const parsed = certificateMergeOptionsScopeSchema.safeParse({
    payeeShortName: url.searchParams.get('payeeShortName') ?? '',
    periodType: url.searchParams.get('periodType') ?? '',
    year: parseOptionalInt(url.searchParams.get('year')),
    ...(url.searchParams.has('quarter')
      ? { quarter: parseOptionalInt(url.searchParams.get('quarter')) }
      : {}),
  })

  if (!parsed.success) {
    return badRequestResponse(
      parsed.error.issues.at(0)?.message ?? 'Invalid merge options.',
    )
  }

  try {
    return jsonResponse({
      entities,
      batches: await listCertificateMergeBatchOptions(parsed.data),
    })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/merge-jobs/options')({
  server: {
    handlers: {
      GET: mergeJobOptionsHandler,
    },
  },
})
