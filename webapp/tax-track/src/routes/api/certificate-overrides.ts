import { createFileRoute } from '@tanstack/react-router'
import type { CertificateOverrideStatus } from '@/lib/certificate-override-server'

import { logAuditEvent } from '@/lib/audit'
import {
  canAccessRoute,
  canRequestCertificateOverride,
} from '@/lib/access-control'
import {
  DEFAULT_CERTIFICATE_OVERRIDE_PAGE_SIZE,
  certificateOverridePageSizeOptions,
  certificateOverrideStatuses,
  createCertificateOverrideRequest,
  createCertificateOverrideRequestSchema,
  listCertificateOverrideRequests,
} from '@/lib/certificate-override-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const parseOverrideStatusFilter = (searchParams: URLSearchParams) => {
  const status = searchParams.get('status') ?? 'pending'
  if (status === 'all') return status

  return certificateOverrideStatuses.includes(
    status as CertificateOverrideStatus,
  )
    ? (status as CertificateOverrideStatus)
    : null
}

const parsePositiveIntegerParam = (value: string | null) => {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const parseOverridePageSize = (value: string | null) => {
  const parsed = parsePositiveIntegerParam(value)
  return certificateOverridePageSizeOptions.some((option) => option === parsed)
    ? parsed
    : DEFAULT_CERTIFICATE_OVERRIDE_PAGE_SIZE
}

export const listCertificateOverrideRequestsHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view override requests.',
    )
  }

  if (!canAccessRoute('overrideRequests', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view override requests.',
    )
  }

  const url = new URL(request.url)
  const status = parseOverrideStatusFilter(url.searchParams)
  if (!status) {
    return badRequestResponse('Invalid override request status filter.')
  }

  try {
    return jsonResponse(
      await listCertificateOverrideRequests({
        status,
        q: url.searchParams.get('q') ?? '',
        page: parsePositiveIntegerParam(url.searchParams.get('page')) ?? 1,
        pageSize: parseOverridePageSize(url.searchParams.get('pageSize')),
      }),
    )
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const createCertificateOverrideRequestHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to request a certificate override.',
    )
  }

  if (!canRequestCertificateOverride(context.role)) {
    return unauthorizedResponse(
      'You do not have permission to request certificate overrides.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    createCertificateOverrideRequestSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const overrideRequest = await createCertificateOverrideRequest({
      ...parsed.data,
      userId: context.userId,
    })

    await logAuditEvent(request, {
      eventType: 'certificate_override_requested',
      actorUserId: context.userId,
      targetId: String(overrideRequest.documentResultId),
      targetType: 'document',
      metadata: {
        requestId: overrideRequest.id,
        batchId: overrideRequest.batchId,
        uploadId: overrideRequest.uploadId,
      },
    }).catch(() => undefined)

    return jsonResponse({ request: overrideRequest }, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/certificate-overrides')({
  server: {
    handlers: {
      GET: listCertificateOverrideRequestsHandler,
      POST: createCertificateOverrideRequestHandler,
    },
  },
})
