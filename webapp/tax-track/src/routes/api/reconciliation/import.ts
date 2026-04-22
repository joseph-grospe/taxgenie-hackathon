import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { importReconciliationWorkbook } from '@/lib/reconciliation-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const reconciliationImportHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to upload reconciliation workbooks.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to upload reconciliation workbooks.',
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return badRequestResponse('Invalid form data.')
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return badRequestResponse('An Excel file is required.')
  }

  try {
    const result = await importReconciliationWorkbook(file)
    return jsonResponse(result, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/reconciliation/import')({
  server: {
    handlers: {
      POST: reconciliationImportHandler,
    },
  },
})
