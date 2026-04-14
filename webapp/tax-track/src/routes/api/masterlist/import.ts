import { createFileRoute } from '@tanstack/react-router'

import { importMasterlistCsvFile } from '@/lib/masterlist-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
} from '@/lib/user-admin-server'

export const importMasterlistHandler = async ({
  request,
}: {
  request: Request
}) => {
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

  try {
    const result = await importMasterlistCsvFile(file)
    return jsonResponse(result, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/masterlist/import')({
  server: {
    handlers: {
      POST: importMasterlistHandler,
    },
  },
})
