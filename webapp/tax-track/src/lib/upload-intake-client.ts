import type { LocalUploadItem } from '@/lib/upload-intake-types'
import {
  MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL,
} from '@/lib/intake-utils'

type IntakeUploadFileLike = Pick<File, 'name' | 'size'>

const formatUploadFileSize = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

export const canRemoveLocalSelectedFile = (
  file: Pick<LocalUploadItem, 'status' | 'uploadId'>,
) => !file.uploadId && ['Pending', 'Error'].includes(file.status)

export const removeLocalSelectedFile = (
  localFiles: Array<LocalUploadItem>,
  clientId: string,
) =>
  localFiles.filter(
    (item) => item.clientId !== clientId || !canRemoveLocalSelectedFile(item),
  )

export const getPendingLocalUploadCount = (
  localFiles: Array<LocalUploadItem>,
) =>
  localFiles.filter((file) => ['Pending', 'Error'].includes(file.status)).length

export const toServerStatus = (status: string): LocalUploadItem['status'] => {
  switch (status) {
    case 'success':
    case 'completed':
      return 'Done'
    case 'duplicate':
      return 'Duplicate'
    case 'error':
      return 'Error'
    case 'processing':
      return 'Processing'
    case 'queued':
    case 'uploaded':
      return 'Queued'
    default:
      return 'Pending'
  }
}

export const isWithinIntakeUploadFileSizeLimit = (
  file: IntakeUploadFileLike,
) => file.size <= MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES

export const buildIntakeUploadSizeLimitMessage = (
  files: Array<IntakeUploadFileLike>,
) => {
  if (files.length === 0) {
    return null
  }

  const visibleFileNames = files
    .slice(0, 3)
    .map((file) => `${file.name} (${formatUploadFileSize(file.size)})`)
  const extraCount = files.length - visibleFileNames.length
  const skippedFiles =
    extraCount > 0
      ? `${visibleFileNames.join(', ')}, and ${extraCount} more`
      : visibleFileNames.join(', ')
  const skippedCount =
    files.length === 1 ? '1 file was skipped' : `${files.length} files were skipped`

  return `${skippedCount}. Each BIR 2307 PDF must be ${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL} or smaller. Skipped: ${skippedFiles}.`
}

export const filterIntakeUploadFilesBySize = <TFile extends IntakeUploadFileLike>(
  files: Array<TFile>,
) => {
  const acceptedFiles: Array<TFile> = []
  const rejectedFiles: Array<TFile> = []

  for (const file of files) {
    if (isWithinIntakeUploadFileSizeLimit(file)) {
      acceptedFiles.push(file)
    } else {
      rejectedFiles.push(file)
    }
  }

  return {
    acceptedFiles,
    rejectedFiles,
    errorMessage: buildIntakeUploadSizeLimitMessage(rejectedFiles),
  }
}

export const xhrPut = (
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (value: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers).forEach(([key, value]) => {
      request.setRequestHeader(key, value)
    })
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }

      onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }

      reject(new Error(`Upload failed with status ${request.status}.`))
    }
    request.onerror = () => reject(new Error('Network error during S3 upload.'))
    request.send(file)
  })
