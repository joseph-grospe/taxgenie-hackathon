import { GetObjectCommand } from '@aws-sdk/client-s3'
import { inArray } from 'drizzle-orm'
import { zipSync } from 'fflate'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type { ListIssueDocumentsOptions } from '@/lib/documents-server'
import { MANILA_TIME_ZONE_OFFSET_MS } from '@/lib/audit-search-state'
import { createS3ServerClient } from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import {
  getFilteredIssueDocuments,
  getOperationalDocument,
  listIssueDocuments,
} from '@/lib/documents-server'
import { intakeFiles } from '@/lib/schema'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

export type IssueOriginalFileSource = Pick<
  IntakeFileRecord,
  'id' | 'originalFileName' | 'storageBucket' | 'storageKey' | 'sizeBytes'
>

export type IssueFileDownloadEntry = {
  uploadId: string
  entryName: string
  originalFileName: string
  bucket: string
  key: string
  sizeBytes: number
}

export type IssueFileDownloadPlan = {
  entries: Array<IssueFileDownloadEntry>
  fileCount: number
  totalSizeBytes: number
}

export type IssueFileZipDownloadResult = {
  bytes: Uint8Array
  contentType: string
  fileName: string
  fileCount: number
  totalSizeBytes: number
}

export type OriginalDocumentFileDownloadResult = {
  bytes: Uint8Array
  contentType: string
  fileName: string
  sizeBytes: number
}

type ReadObjectBytes = (input: {
  bucket: string
  key: string
}) => Promise<Uint8Array>

type BuildIssueFileDownloadPlanOptions = {
  maxFiles?: number
  maxSizeBytes?: number
}

type BuildIssueFileZipDownloadOptions = BuildIssueFileDownloadPlanOptions & {
  date?: Date
  readObjectBytes?: ReadObjectBytes
}

export const ISSUE_FILE_DOWNLOAD_MAX_FILES = 50
export const ISSUE_FILE_DOWNLOAD_MAX_SIZE_BYTES = 200 * 1024 * 1024
export const ISSUE_FILE_DOWNLOAD_MAX_SIZE_LABEL = '200 MiB'
export const ISSUE_FILE_DOWNLOAD_FALLBACK_FILE_NAME = 'Issue-Files.zip'

const ZIP_SAFE_FILE_NAME_PATTERN = /[^\w .()[\]-]+/gu
const PDF_EXTENSION_PATTERN = /\.pdf$/iu

const pad2 = (value: number) => String(value).padStart(2, '0')

const formatIssueFileTimestamp = (date: Date) => {
  const manilaDate = new Date(date.getTime() + MANILA_TIME_ZONE_OFFSET_MS)

  return `${manilaDate.getUTCFullYear()}${pad2(
    manilaDate.getUTCMonth() + 1,
  )}${pad2(manilaDate.getUTCDate())}-${pad2(
    manilaDate.getUTCHours(),
  )}${pad2(manilaDate.getUTCMinutes())}${pad2(manilaDate.getUTCSeconds())}`
}

export const buildIssueFilesZipFileName = (date = new Date()) =>
  `Issue-Files-${formatIssueFileTimestamp(date)}.zip`

const toObjectFileName = (value: string) =>
  value.split('/').pop()?.trim() || value.trim()

const toZipSafeFileName = (value: string) => {
  const fileName = toObjectFileName(value)
    .replace(/[\\/]/gu, '_')
    .replace(ZIP_SAFE_FILE_NAME_PATTERN, '_')
    .replace(/\s+/gu, ' ')
    .trim()

  const normalized = fileName || 'issue-file.pdf'
  return PDF_EXTENSION_PATTERN.test(normalized)
    ? normalized
    : `${normalized}.pdf`
}

export const buildIssueFileZipEntryName = (
  fileName: string,
  usedNames: Set<string>,
) => {
  const safeName = toZipSafeFileName(fileName)
  const extensionMatch = safeName.match(/(\.pdf)$/iu)
  const extension = extensionMatch?.[1] ?? '.pdf'
  const stem = safeName.slice(0, safeName.length - extension.length).trim()
  let candidate = `${stem || 'issue-file'}${extension}`
  let suffix = 2

  while (usedNames.has(candidate)) {
    candidate = `${stem || 'issue-file'} (${suffix})${extension}`
    suffix += 1
  }

  usedNames.add(candidate)
  return candidate
}

export const toIssueFileDownloadLimitMessage = (limit: number) =>
  `Download is limited to ${limit} files. Narrow the Issues Queue filters and try again.`

export const toIssueFileDownloadSizeLimitMessage = (limitLabel: string) =>
  `Download is limited to ${limitLabel}. Narrow the Issues Queue filters and try again.`

const getUniqueIssueDocumentsByUploadId = (
  documents: Array<OperationalDocumentView>,
) => {
  const seen = new Set<string>()
  const uniqueDocuments: Array<OperationalDocumentView> = []

  for (const document of documents) {
    if (seen.has(document.uploadId)) {
      continue
    }

    seen.add(document.uploadId)
    uniqueDocuments.push(document)
  }

  return uniqueDocuments
}

export const buildIssueFileDownloadPlan = (
  documents: Array<OperationalDocumentView>,
  fileSources: Array<IssueOriginalFileSource>,
  input: ListIssueDocumentsOptions,
  options: BuildIssueFileDownloadPlanOptions = {},
): IssueFileDownloadPlan => {
  const maxFiles = options.maxFiles ?? ISSUE_FILE_DOWNLOAD_MAX_FILES
  const maxSizeBytes =
    options.maxSizeBytes ?? ISSUE_FILE_DOWNLOAD_MAX_SIZE_BYTES
  const { filteredDocuments } = getFilteredIssueDocuments(documents, input)
  const uniqueDocuments = getUniqueIssueDocumentsByUploadId(filteredDocuments)

  if (uniqueDocuments.length === 0) {
    throw new Error('No original issue files matched the current filters.')
  }

  if (uniqueDocuments.length > maxFiles) {
    throw new Error(toIssueFileDownloadLimitMessage(maxFiles))
  }

  const fileSourceByUploadId = new Map(
    fileSources.map((fileSource) => [fileSource.id, fileSource]),
  )
  const usedEntryNames = new Set<string>()
  const entries = uniqueDocuments.map((document) => {
    const source = fileSourceByUploadId.get(document.uploadId)

    if (!source) {
      throw new Error(`Original file not found for ${document.fileName}.`)
    }

    return {
      uploadId: document.uploadId,
      entryName: buildIssueFileZipEntryName(
        source.originalFileName || document.fileName,
        usedEntryNames,
      ),
      originalFileName: source.originalFileName || document.fileName,
      bucket: source.storageBucket,
      key: source.storageKey,
      sizeBytes: source.sizeBytes,
    }
  })
  const totalSizeBytes = entries.reduce(
    (total, entry) => total + entry.sizeBytes,
    0,
  )

  if (totalSizeBytes > maxSizeBytes) {
    throw new Error(
      toIssueFileDownloadSizeLimitMessage(ISSUE_FILE_DOWNLOAD_MAX_SIZE_LABEL),
    )
  }

  return {
    entries,
    fileCount: entries.length,
    totalSizeBytes,
  }
}

const readS3ObjectBytes: ReadObjectBytes = async ({ bucket, key }) => {
  const client = createS3ServerClient()
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  )

  const transformer = response.Body as {
    transformToByteArray?: () => Promise<Uint8Array>
  }

  if (!transformer.transformToByteArray) {
    throw new Error('Unexpected S3 object body format.')
  }

  return transformer.transformToByteArray()
}

const readS3Object = async (input: { bucket: string; key: string }) => {
  const client = createS3ServerClient()
  const response = await client.send(
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }),
  )

  const transformer = response.Body as {
    transformToByteArray?: () => Promise<Uint8Array>
  }

  if (!transformer.transformToByteArray) {
    throw new Error('Unexpected S3 object body format.')
  }

  return {
    bytes: await transformer.transformToByteArray(),
    contentType: response.ContentType ?? 'application/pdf',
  }
}

export const buildIssueFileZipDownload = async (
  documents: Array<OperationalDocumentView>,
  fileSources: Array<IssueOriginalFileSource>,
  input: ListIssueDocumentsOptions,
  options: BuildIssueFileZipDownloadOptions = {},
): Promise<IssueFileZipDownloadResult> => {
  const plan = buildIssueFileDownloadPlan(
    documents,
    fileSources,
    input,
    options,
  )
  const readObjectBytes = options.readObjectBytes ?? readS3ObjectBytes
  const entryBytes = await Promise.all(
    plan.entries.map(async (entry) => ({
      entryName: entry.entryName,
      bytes: await readObjectBytes({
        bucket: entry.bucket,
        key: entry.key,
      }),
    })),
  )
  const zipEntries: Record<string, Uint8Array> = {}

  for (const entry of entryBytes) {
    zipEntries[entry.entryName] = entry.bytes
  }

  return {
    bytes: zipSync(zipEntries),
    contentType: 'application/zip',
    fileName: buildIssueFilesZipFileName(options.date),
    fileCount: plan.fileCount,
    totalSizeBytes: plan.totalSizeBytes,
  }
}

const getOriginalFileSources = async (
  uploadIds: Array<string>,
): Promise<Array<IssueOriginalFileSource>> => {
  if (uploadIds.length === 0) {
    return []
  }

  const db = getDb()

  return db
    .select({
      id: intakeFiles.id,
      originalFileName: intakeFiles.originalFileName,
      storageBucket: intakeFiles.storageBucket,
      storageKey: intakeFiles.storageKey,
      sizeBytes: intakeFiles.sizeBytes,
    })
    .from(intakeFiles)
    .where(inArray(intakeFiles.id, uploadIds))
}

export const getIssueFilesZipDownload = async (
  input: ListIssueDocumentsOptions,
): Promise<IssueFileZipDownloadResult> => {
  const result = await listIssueDocuments({
    ...input,
    page: 1,
    pageSize: ISSUE_FILE_DOWNLOAD_MAX_FILES + 1,
  })

  if (result.pagination.totalItems > ISSUE_FILE_DOWNLOAD_MAX_FILES) {
    throw new Error(
      toIssueFileDownloadLimitMessage(ISSUE_FILE_DOWNLOAD_MAX_FILES),
    )
  }

  const uploadIds = result.documents.map((document) => document.uploadId)
  const sources = await getOriginalFileSources(uploadIds)

  return buildIssueFileZipDownload(result.documents, sources, input)
}

export const getOriginalDocumentFileDownload = async (
  documentId: string,
): Promise<OriginalDocumentFileDownloadResult> => {
  const document = await getOperationalDocument(documentId)
  if (!document) {
    throw new Error('Document not found.')
  }

  const sources = await getOriginalFileSources([document.uploadId])
  const source = sources.at(0)
  if (!source) {
    throw new Error('Original file not found.')
  }

  const object = await readS3Object({
    bucket: source.storageBucket,
    key: source.storageKey,
  })

  return {
    bytes: object.bytes,
    contentType: object.contentType,
    fileName: source.originalFileName || document.fileName,
    sizeBytes: source.sizeBytes,
  }
}
