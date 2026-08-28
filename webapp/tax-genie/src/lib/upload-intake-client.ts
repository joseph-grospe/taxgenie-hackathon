import type { LocalUploadItem } from '@/lib/upload-intake-types'
import {
  MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL,
  MIN_INTAKE_UPLOAD_FILE_SIZE_BYTES,
} from '@/lib/intake-utils'
import {
  UPLOAD_CONCURRENCY_LIMIT,
  UPLOAD_PRESIGN_CHUNK_SIZE,
} from '@/lib/upload-intake-constants'

type IntakeUploadFileLike = Pick<File, 'name' | 'size'>
type IntakeUploadPdfCheckFileLike = IntakeUploadFileLike &
  Pick<File, 'arrayBuffer'>
export type IntakeUploadFileSizeRejectionReason = 'empty' | 'too_large'
type PdfLoadForEncryptionCheck = (content: ArrayBuffer) => Promise<unknown>

const formatUploadFileSize = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

const buildSkippedCountLabel = (count: number) =>
  count === 1 ? '1 file was skipped' : `${count} files were skipped`

const formatSkippedFileNames = (
  files: Array<IntakeUploadFileLike>,
  options: { includeSize?: boolean } = {},
) => {
  const visibleFileNames = files
    .slice(0, 3)
    .map((file) =>
      options.includeSize === false
        ? file.name
        : `${file.name} (${formatUploadFileSize(file.size)})`,
    )
  const extraCount = files.length - visibleFileNames.length

  return extraCount > 0
    ? `${visibleFileNames.join(', ')}, and ${extraCount} more`
    : visibleFileNames.join(', ')
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

export const buildLocalSelectionSummary = (
  localFiles: Array<LocalUploadItem>,
) => {
  const nameCounts = new Map<string, number>()
  let totalSizeBytes = 0
  let readyCount = 0
  let errorCount = 0

  for (const item of localFiles) {
    const normalizedName = item.file.name.trim().toLowerCase()
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1)
    totalSizeBytes += item.file.size

    if (['Pending', 'Error'].includes(item.status)) {
      readyCount += 1
    }

    if (item.status === 'Error') {
      errorCount += 1
    }
  }

  const duplicateNameCount = Array.from(nameCounts.values()).reduce(
    (count, value) => count + Math.max(value - 1, 0),
    0,
  )

  return {
    selectedCount: localFiles.length,
    totalSizeBytes,
    readyCount,
    errorCount,
    duplicateNameCount,
  }
}

export const chunkUploadItems = <TItem>(
  items: Array<TItem>,
  chunkSize = UPLOAD_PRESIGN_CHUNK_SIZE,
) => {
  const chunks: Array<Array<TItem>> = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

export const runWithConcurrencyLimit = async <TItem>(
  items: Array<TItem>,
  worker: (item: TItem, index: number) => Promise<void>,
  concurrencyLimit = UPLOAD_CONCURRENCY_LIMIT,
) => {
  let nextIndex = 0
  let activeWorkers = 0
  const workerCount = Math.min(Math.max(concurrencyLimit, 1), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        const item = items[currentIndex]
        nextIndex += 1
        activeWorkers += 1

        try {
          await worker(item, currentIndex)
        } finally {
          activeWorkers -= 1
        }
      }
    }),
  )

  return activeWorkers
}

const loadPdfForEncryptionCheck: PdfLoadForEncryptionCheck = async (
  content,
) => {
  const { PDFDocument } = await import('pdf-lib')
  return PDFDocument.load(content)
}

export const isEncryptedPdfLoadError = (error: unknown) =>
  error instanceof Error &&
  /pdfdocument\.load.*encrypted|encrypted.*pdfdocument\.load/iu.test(
    error.message,
  )

export const buildEncryptedPdfUploadMessage = (
  files: Array<IntakeUploadFileLike>,
) => {
  if (files.length === 0) {
    return null
  }

  const encryptedFilePronoun = files.length === 1 ? 'it is' : 'they are'
  return `${buildSkippedCountLabel(files.length)} because ${encryptedFilePronoun} encrypted: ${formatSkippedFileNames(
    files,
    { includeSize: false },
  )}. Remove encryption and select again.`
}

export const filterEncryptedPdfUploadFiles = async <
  TFile extends IntakeUploadPdfCheckFileLike,
>(
  files: Array<TFile>,
  options: {
    loadPdf?: PdfLoadForEncryptionCheck
    concurrencyLimit?: number
  } = {},
) => {
  const encryptedIndexes = new Set<number>()
  const loadPdf = options.loadPdf ?? loadPdfForEncryptionCheck

  await runWithConcurrencyLimit(
    files,
    async (file, index) => {
      try {
        await loadPdf(await file.arrayBuffer())
      } catch (error) {
        if (isEncryptedPdfLoadError(error)) {
          encryptedIndexes.add(index)
        }
      }
    },
    options.concurrencyLimit,
  )

  const acceptedFiles: Array<TFile> = []
  const rejectedFiles: Array<TFile> = []

  files.forEach((file, index) => {
    if (encryptedIndexes.has(index)) {
      rejectedFiles.push(file)
    } else {
      acceptedFiles.push(file)
    }
  })

  return {
    acceptedFiles,
    rejectedFiles,
    errorMessage: buildEncryptedPdfUploadMessage(rejectedFiles),
  }
}

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

export const isWithinIntakeUploadFileSizeLimit = (file: IntakeUploadFileLike) =>
  file.size >= MIN_INTAKE_UPLOAD_FILE_SIZE_BYTES &&
  file.size <= MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES

export const getIntakeUploadFileSizeRejectionReason = (
  file: IntakeUploadFileLike,
): IntakeUploadFileSizeRejectionReason | null => {
  if (file.size < MIN_INTAKE_UPLOAD_FILE_SIZE_BYTES) {
    return 'empty'
  }

  if (file.size > MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES) {
    return 'too_large'
  }

  return null
}

export const getIntakeUploadFileSizeRejectionMessage = (
  reason: IntakeUploadFileSizeRejectionReason,
) => {
  switch (reason) {
    case 'empty':
      return 'File is empty.'
    case 'too_large':
      return `File exceeds ${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL}.`
  }
}

export const buildIntakeUploadSizeLimitMessage = (
  files: Array<IntakeUploadFileLike>,
) => {
  if (files.length === 0) {
    return null
  }

  const emptyFiles = files.filter(
    (file) => file.size < MIN_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  )
  const oversizedFiles = files.filter(
    (file) => file.size > MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  )
  const messages: Array<string> = []

  if (emptyFiles.length > 0) {
    const emptyFilePronoun = emptyFiles.length === 1 ? 'it is' : 'they are'
    messages.push(
      `${buildSkippedCountLabel(emptyFiles.length)} because ${emptyFilePronoun} empty: ${formatSkippedFileNames(
        emptyFiles,
        { includeSize: false },
      )}.`,
    )
  }

  if (oversizedFiles.length > 0) {
    messages.push(
      `${buildSkippedCountLabel(oversizedFiles.length)}. Each BIR 2307 PDF must be ${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL} or smaller. Skipped: ${formatSkippedFileNames(
        oversizedFiles,
      )}.`,
    )
  }

  return messages.join(' ')
}

export const filterIntakeUploadFilesBySize = <
  TFile extends IntakeUploadFileLike,
>(
  files: Array<TFile>,
) => {
  const acceptedFiles: Array<TFile> = []
  const rejectedFiles: Array<TFile> = []

  for (const file of files) {
    if (getIntakeUploadFileSizeRejectionReason(file) === null) {
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
