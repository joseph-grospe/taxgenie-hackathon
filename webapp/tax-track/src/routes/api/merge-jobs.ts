import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import {
  certificateMergeRequestSchema,
  createCertificateMergeJob,
  listCertificateMergeJobs,
} from '@/lib/certificate-merge-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const requireMergeAccess = async (request: Request) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return {
      ok: false as const,
      response: notAuthenticatedResponse(
        'Authentication is required to merge signed PDFs.',
      ),
    }
  }

  if (!canAccessRoute('reports', context.role)) {
    return {
      ok: false as const,
      response: unauthorizedResponse(
        'You do not have permission to view reports.',
      ),
    }
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return {
      ok: false as const,
      response: unauthorizedResponse(
        'You do not have permission to export signed PDF merges.',
      ),
    }
  }

  return { ok: true as const, context }
}

const parsePositiveInt = (value: string | null, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const listMergeJobsHandler = async ({
  request,
}: {
  request: Request
}) => {
  const access = await requireMergeAccess(request)
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const view = url.searchParams.get('view') === 'all' ? 'all' : 'recent'
  const result = await listCertificateMergeJobs({
    userId: access.context.userId,
    allowAdmin: access.context.role === 'admin',
    view,
    page: parsePositiveInt(url.searchParams.get('page'), 1),
    pageSize: parsePositiveInt(url.searchParams.get('pageSize'), 25),
  })

  return jsonResponse(result)
}

export const createMergeJobHandler = async ({
  request,
}: {
  request: Request
}) => {
  const access = await requireMergeAccess(request)
  if (!access.ok) {
    return access.response
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    certificateMergeRequestSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const job = await createCertificateMergeJob({
      request: parsed.data,
      userId: access.context.userId,
    })

    return jsonResponse({ job }, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/merge-jobs')({
  server: {
    handlers: {
      GET: listMergeJobsHandler,
      POST: createMergeJobHandler,
    },
  },
})
