import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { importEntitiesCsvFile } from '@/lib/entities-server'
import { REFERENCE_DATA_MAX_FILE_BYTES } from '@/lib/reference-data'
import {
  authorizeSuperAdminRequest,
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
} from '@/lib/user-admin-server'

export const importEntitiesHandler = async ({
  request,
}: {
  request: Request
}) => {
  const authorization = await authorizeSuperAdminRequest(request)
  if (!authorization.ok) {
    return authorization.response
  }

  let formData: FormData

  try {
    formData = await request.formData()
  } catch {
    return badRequestResponse('Invalid form data.')
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return badRequestResponse('A CSV file is required.')
  }

  if (file.size > REFERENCE_DATA_MAX_FILE_BYTES) {
    return jsonResponse(
      { error: 'CSV files may not exceed 10 MiB.' },
      { status: 413 },
    )
  }

  try {
    const result = await importEntitiesCsvFile(file)
    await logAuditEvent(request, {
      eventType: 'reference_data_imported',
      actorUserId: authorization.context.userId,
      targetId: 'entities',
      targetType: 'reference_data',
      metadata: {
        dataset: 'entities',
        fileName: result.fileName,
        rowCount: result.insertedCount,
      },
    }).catch(() => undefined)
    return jsonResponse(result, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/entities/import')({
  server: {
    handlers: {
      POST: importEntitiesHandler,
    },
  },
})
