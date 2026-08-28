import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildSignatureProfileImageKey,
  buildSignedCertificateKey,
} from '@taxgenie/shared'
import {
  formatTinForDisplay,
  normalizeTinDigits,
} from '@taxgenie/shared/utils/tin'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { EntityStorageInput } from '@taxgenie/shared'
import type { PDFFont, PDFPage } from 'pdf-lib'
import type {
  SignCertificateRequest,
  SignCertificateTargetInput,
  SignaturePlacementTemplate,
  SignatureProfileUpsertInput,
  SignatureProfileView,
  SignatureRect,
  SigningContextView,
  SigningTargetView,
} from '@/lib/signing-module'
import { MAX_SIGNATURE_IMAGE_BYTES } from '@/lib/signing-module'
import {
  getDefaultSignatureImageRect,
  getSignatureCaptionFieldRects,
  getSignatureCaptionLayoutRects,
  getSignatureTextFontSize,
} from '@/lib/signing-placement'

import {
  logBatchStageTimingError,
  recordBatchStageTiming,
} from '@/lib/batch-stage-timing-server'
import { getDb } from '@/lib/db'
import {
  authUserTable,
  certificateResults,
  certificateSignatureTemplates,
  certificateSignedArtifacts,
  intakeBatches,
  intakeFiles,
  userSignatureProfiles,
} from '@/lib/schema'
import {
  BATCH_SIGNING_NOT_READY_MESSAGE,
  isBatchReadyForSigning,
  resolveOverallStatus,
} from '@/lib/intake-utils'
import {
  createS3ServerClient,
  getStorageBucketName,
  getStoragePrefix,
} from '@/lib/aws-server'

type CertificateResultRecord = typeof certificateResults.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect
type SignatureProfileRecord = typeof userSignatureProfiles.$inferSelect
type SignatureTemplateRecord = typeof certificateSignatureTemplates.$inferSelect
type SignedArtifactRecord = typeof certificateSignedArtifacts.$inferSelect
type UserRecord = typeof authUserTable.$inferSelect

type SigningTarget = {
  result: CertificateResultRecord
  file: IntakeFileRecord
  templateKey: string
  template: SignatureTemplateRecord | null
  signedArtifact: SignedArtifactRecord | null
  signedByUser: UserRecord | null
  sourcePdf: ObjectLocation
  previewPageNumber: number
}

type SigningDocument = {
  documentId: string
  fileName: string
  targets: Array<SigningTarget>
}

type ObjectLocation = {
  bucket: string
  key: string
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const SIGNATURE_IMAGE_PATTERN =
  /^data:(image\/(?:png|jpeg));base64,([a-zA-Z0-9+/=\s]+)$/u
const PNG_FILE_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_FILE_SIGNATURE = [0xff, 0xd8, 0xff]

const toDisplayDate = (value: Date | null | undefined) =>
  value ? DATE_FORMATTER.format(value) : undefined

type SigningSummaryRecord = {
  signingStatus: 'unsigned' | 'signed' | 'failed'
  signedAt?: string
  signedByName?: string
  signedPdfUrl?: string
}

const toDocumentUrl = (input: { key: string; bucket?: string }) => {
  const params = new URLSearchParams({ key: input.key })
  if (input.bucket) {
    params.set('bucket', input.bucket)
  }

  return `/api/s3-object?${params.toString()}`
}

const toDataUrl = (bytes: Uint8Array, contentType: string) =>
  `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`

const toObjectFileName = (key: string) => key.split('/').pop()?.trim() || key

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const isNumericDocumentId = (documentId: string) => /^\d+$/u.test(documentId)

const ZIP_SAFE_FILE_NAME_PATTERN = /[^\w .()[\]-]+/gu
const PDF_EXTENSION_PATTERN = /\.pdf$/iu

const toZipSafeFileName = (value: string) => {
  const fileName = toObjectFileName(value)
    .replace(/[\\/]/gu, '_')
    .replace(ZIP_SAFE_FILE_NAME_PATTERN, '_')
    .replace(/\s+/gu, ' ')
    .trim()

  const normalized = fileName || 'signed-certificate.pdf'
  return PDF_EXTENSION_PATTERN.test(normalized)
    ? normalized
    : `${normalized}.pdf`
}

export const buildSignedCertificateZipEntryName = (
  fileName: string,
  usedNames: Set<string>,
) => {
  const safeName = toZipSafeFileName(fileName)
  const extensionMatch = safeName.match(/(\.pdf)$/iu)
  const extension = extensionMatch?.[1] ?? '.pdf'
  const stem = safeName.slice(0, safeName.length - extension.length).trim()
  let candidate = `${stem || 'signed-certificate'}${extension}`
  let suffix = 2

  while (usedNames.has(candidate)) {
    candidate = `${stem || 'signed-certificate'} (${suffix})${extension}`
    suffix += 1
  }

  usedNames.add(candidate)
  return candidate
}

const toBatchZipBaseName = (value: string) =>
  value
    .replace(/[\\/]/gu, '_')
    .replace(/[^\w .()[\]-]+/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim() || 'upload-batch'

export const buildSignedBatchCertificatesZipFileName = (batch: {
  id: string
  name?: string | null
}) =>
  `Signed-Certificates-${toBatchZipBaseName(batch.name?.trim() || batch.id)}.zip`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isMissingS3ObjectError = (error: unknown) => {
  if (!isRecord(error)) {
    return false
  }

  const name = typeof error.name === 'string' ? error.name : ''
  const code =
    typeof error.Code === 'string'
      ? error.Code
      : typeof error.code === 'string'
        ? error.code
        : ''
  const message = typeof error.message === 'string' ? error.message : ''
  const metadata = isRecord(error.$metadata) ? error.$metadata : null
  const httpStatusCode =
    metadata && typeof metadata.httpStatusCode === 'number'
      ? metadata.httpStatusCode
      : undefined

  return (
    httpStatusCode === 404 ||
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    /specified key does not exist/iu.test(message)
  )
}

const requireCertificateId = (documentId: string) => {
  if (!isNumericDocumentId(documentId)) {
    throw new Error('Certificate not found.')
  }

  return Number.parseInt(documentId, 10)
}

const ensureReadyCertificate = (result: CertificateResultRecord) => {
  if (result.status !== 'accepted') {
    throw new Error('Only ready certificate documents can be signed.')
  }
}

const isBatchFileSigningReady = (file: IntakeFileRecord) =>
  resolveOverallStatus(file) === 'success'

const isFileBatchReadyForSigning = (files: Array<IntakeFileRecord>) =>
  isBatchReadyForSigning({
    activeFileCount: files.length,
    successCount: files.filter(isBatchFileSigningReady).length,
  })

const buildTemplateKey = (file: IntakeFileRecord) => {
  const documentType = file.certificateDocumentType?.trim()
  const issuer = file.certificateIssuerShortNameNormalized?.trim()

  if (!documentType || !issuer) {
    return 'default-bir-2307'
  }

  return `${documentType}:${issuer}`
}

const buildSignatureImageKey = (
  userId: string,
  mimeType: 'image/png' | 'image/jpeg',
) => {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg'
  return buildSignatureProfileImageKey({
    prefix: getStoragePrefix(),
    userId,
    assetId: randomUUID(),
    extension,
  })
}

const buildSignedPdfKey = (
  result: CertificateResultRecord,
  file: IntakeFileRecord,
  signedArtifactId: string,
) => {
  return buildSignedCertificateKey({
    prefix: getStoragePrefix(),
    entityKey: getResultEntityKey(result),
    customerKey: getResultCustomerKey(result),
    period: result.periodEnd ?? 'period-unknown',
    batchId: file.batchId,
    certificateId: result.id,
    signedArtifactId,
  })
}

const getResultEntityKey = (result: CertificateResultRecord) =>
  buildOptionalEntityStorageKey({
    id: result.entityId ?? undefined,
    shortName: result.entityShortName,
  } satisfies Partial<EntityStorageInput>)

const getResultCustomerKey = (result: CertificateResultRecord) =>
  buildOptionalCustomerStorageKey({
    shortName: result.payorShortName,
  })

const hasFileSignature = (bytes: Uint8Array, signature: Array<number>) =>
  signature.every((value, index) => bytes[index] === value)

export const decodeSignatureImage = (input: string) => {
  const match = input.trim().match(SIGNATURE_IMAGE_PATTERN)
  if (!match) {
    throw new Error('Signature image must be a PNG or JPEG data URL.')
  }

  const mimeType = match[1] as 'image/png' | 'image/jpeg'
  const bytes = Uint8Array.from(
    Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  )

  if (bytes.byteLength > MAX_SIGNATURE_IMAGE_BYTES) {
    throw new Error('Signature image must be 3 MB or smaller.')
  }

  const hasExpectedSignature =
    mimeType === 'image/png'
      ? hasFileSignature(bytes, PNG_FILE_SIGNATURE)
      : hasFileSignature(bytes, JPEG_FILE_SIGNATURE)

  if (!hasExpectedSignature) {
    throw new Error('Signature image content does not match its file type.')
  }

  return {
    mimeType,
    bytes,
  }
}

const readS3ObjectBytes = async (input: ObjectLocation) => {
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

  return transformer.transformToByteArray()
}

const writeS3Object = async (
  input: ObjectLocation,
  bytes: Uint8Array,
  contentType: string,
) => {
  const client = createS3ServerClient()

  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: 'private, max-age=0, no-cache, no-store, must-revalidate',
    }),
  )
}

export const buildPlacementTemplate = (
  pageNumber: number,
  signatureRect: SignatureRect,
): SignaturePlacementTemplate => ({
  pageNumber,
  signatureRect,
  ...getSignatureCaptionFieldRects(signatureRect),
})

const toPdfRect = (
  pageWidth: number,
  pageHeight: number,
  rect: SignatureRect,
) => ({
  x: rect.x * pageWidth,
  y: pageHeight - (rect.y + rect.height) * pageHeight,
  width: rect.width * pageWidth,
  height: rect.height * pageHeight,
})

const resolveSourcePdf = (
  result: CertificateResultRecord,
  file: IntakeFileRecord,
) => {
  const resultsBucket = getStorageBucketName()

  if (
    typeof result.artifactKey === 'string' &&
    result.artifactKey.trim().length > 0 &&
    result.artifactKey.toLowerCase().endsWith('.pdf')
  ) {
    return {
      sourcePdf: {
        bucket: resultsBucket,
        key: result.artifactKey,
      },
      previewPageNumber: 1,
    }
  }

  if (file.storageKey.trim().length > 0) {
    return {
      sourcePdf: {
        bucket: file.storageBucket,
        key: file.storageKey,
      },
      previewPageNumber: 1,
    }
  }

  throw new Error('No PDF source is available for this certificate.')
}

const toSignatureProfileView = async (
  record: SignatureProfileRecord,
): Promise<SignatureProfileView> => {
  const signatureBytes = await readS3ObjectBytes({
    bucket: getStorageBucketName(),
    key: record.signatureImageKey,
  })

  return {
    displayName: record.displayName,
    designation: record.designation,
    tin: record.tin,
    signatureImageKey: record.signatureImageKey,
    signatureImageUrl: toDataUrl(signatureBytes, record.signatureImageMimeType),
    signatureImageMimeType: record.signatureImageMimeType as
      | 'image/png'
      | 'image/jpeg',
    signatureImageWidth: record.signatureImageWidth,
    signatureImageHeight: record.signatureImageHeight,
    updatedAt: toDisplayDate(record.updatedAt),
  }
}

const extractPayee = (result: CertificateResultRecord) =>
  result.payeeName?.trim() ||
  result.signerCompanyName?.trim() ||
  'Unknown payee'

const getSignatureProfileRecord = async (userId: string) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(userSignatureProfiles)
    .where(eq(userSignatureProfiles.userId, userId))
    .limit(1)

  return rows.at(0) ?? null
}

const toTemplatePlacement = (
  target: SigningTarget,
): SignaturePlacementTemplate | null =>
  target.signedArtifact?.placementSnapshot ??
  (target.template
    ? {
        pageNumber: target.template.pageNumber,
        signatureRect: target.template.signatureRect,
        signatureImageRect: undefined,
        nameRect: target.template.nameRect,
        designationRect: target.template.designationRect,
        tinRect: target.template.tinRect,
      }
    : null)

export const getSignatureProfile = async (userId: string) => {
  const profile = await getSignatureProfileRecord(userId)
  if (profile === null) {
    return null
  }

  try {
    return await toSignatureProfileView(profile)
  } catch (error) {
    if (isMissingS3ObjectError(error)) {
      return null
    }

    throw error
  }
}

export const getSignatureProfileImage = async (userId: string) => {
  const profile = await getSignatureProfileRecord(userId)
  if (profile === null) {
    return null
  }

  let bytes: Uint8Array
  try {
    bytes = await readS3ObjectBytes({
      bucket: getStorageBucketName(),
      key: profile.signatureImageKey,
    })
  } catch (error) {
    if (isMissingS3ObjectError(error)) {
      return null
    }

    throw error
  }

  return {
    bytes,
    contentType: profile.signatureImageMimeType,
    fileName: toObjectFileName(profile.signatureImageKey),
  }
}

export const upsertSignatureProfile = async (
  userId: string,
  input: SignatureProfileUpsertInput,
) => {
  const db = getDb()
  const existing = await getSignatureProfileRecord(userId)
  const tin = normalizeTinDigits(input.tin)

  if (!tin) {
    throw new Error('TIN is required.')
  }

  let signatureImageKey = ''
  let signatureImageMimeType = ''
  let signatureImageWidth = 0
  let signatureImageHeight = 0

  if (existing !== null) {
    signatureImageKey = existing.signatureImageKey
    signatureImageMimeType = existing.signatureImageMimeType
    signatureImageWidth = existing.signatureImageWidth
    signatureImageHeight = existing.signatureImageHeight
  }

  if (input.signatureImageDataUrl) {
    const { mimeType, bytes } = decodeSignatureImage(
      input.signatureImageDataUrl,
    )
    const objectKey = buildSignatureImageKey(userId, mimeType)
    await writeS3Object(
      {
        bucket: getStorageBucketName(),
        key: objectKey,
      },
      bytes,
      mimeType,
    )

    signatureImageKey = objectKey
    signatureImageMimeType = mimeType
    signatureImageWidth = input.signatureImageWidth ?? 0
    signatureImageHeight = input.signatureImageHeight ?? 0
  }

  if (!signatureImageKey) {
    throw new Error('A signature image is required before saving this profile.')
  }

  const [saved] = await db
    .insert(userSignatureProfiles)
    .values({
      userId,
      displayName: input.displayName.trim(),
      designation: input.designation.trim(),
      tin,
      signatureImageKey,
      signatureImageMimeType,
      signatureImageWidth,
      signatureImageHeight,
    })
    .onConflictDoUpdate({
      target: userSignatureProfiles.userId,
      set: {
        displayName: input.displayName.trim(),
        designation: input.designation.trim(),
        tin,
        signatureImageKey,
        signatureImageMimeType,
        signatureImageWidth,
        signatureImageHeight,
        updatedAt: new Date(),
      },
    })
    .returning()

  return await toSignatureProfileView(saved)
}

const getSigningDocument = async (
  documentId: string,
): Promise<SigningDocument> => {
  const db = getDb()
  let uploadId = documentId

  if (isNumericDocumentId(documentId)) {
    const resultId = requireCertificateId(documentId)
    const resultRows = await db
      .select()
      .from(certificateResults)
      .where(eq(certificateResults.id, resultId))
      .limit(1)
    const result = resultRows.at(0) ?? null

    if (result === null) {
      throw new Error('Certificate not found.')
    }

    ensureReadyCertificate(result)
    uploadId = result.uploadId
  }

  const fileRows = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, uploadId))
    .limit(1)
  const file = fileRows.at(0) ?? null

  if (file === null) {
    throw new Error('Source upload record not found.')
  }

  const results = await db
    .select()
    .from(certificateResults)
    .where(eq(certificateResults.uploadId, file.id))

  const readyCertificateResults = results
    .filter((result) => result.status === 'accepted')
    .sort((left, right) => left.id - right.id)

  if (readyCertificateResults.length === 0) {
    throw new Error(
      'No ready certificate documents were found for this upload.',
    )
  }

  return buildSigningDocumentFromResults({
    documentId: file.id,
    fileName: file.originalFileName,
    files: [file],
    readyCertificateResults,
  })
}

const buildSigningDocumentFromResults = async (input: {
  documentId: string
  fileName: string
  files: Array<IntakeFileRecord>
  readyCertificateResults: Array<CertificateResultRecord>
}): Promise<SigningDocument> => {
  const db = getDb()
  const fileById = new Map(input.files.map((file) => [file.id, file]))
  const templateKeys = Array.from(
    new Set(
      input.readyCertificateResults.flatMap((result) => {
        const file = fileById.get(result.uploadId)
        return file ? [buildTemplateKey(file)] : []
      }),
    ),
  )

  const [templates, artifacts] = await Promise.all([
    templateKeys.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(certificateSignatureTemplates)
          .where(
            inArray(certificateSignatureTemplates.templateKey, templateKeys),
          ),
    db
      .select()
      .from(certificateSignedArtifacts)
      .where(
        inArray(
          certificateSignedArtifacts.certificateId,
          input.readyCertificateResults.map((result) => result.id),
        ),
      ),
  ])

  const templateByKey = new Map(
    templates.map((template) => [template.templateKey, template]),
  )
  const artifactByResultId = new Map(
    artifacts.map((artifact) => [artifact.certificateId, artifact]),
  )

  const signerIds = Array.from(
    new Set(artifacts.map((artifact) => artifact.signedByUserId)),
  )
  const signers =
    signerIds.length === 0
      ? []
      : await db
          .select()
          .from(authUserTable)
          .where(inArray(authUserTable.id, signerIds))
  const signerById = new Map(signers.map((signer) => [signer.id, signer]))

  const targets = input.readyCertificateResults.flatMap<SigningTarget>(
    (result) => {
      const file = fileById.get(result.uploadId)
      if (!file) {
        return []
      }

      const templateKey = buildTemplateKey(file)
      const artifact = artifactByResultId.get(result.id) ?? null
      const resolvedSource = resolveSourcePdf(result, file)

      return [
        {
          result,
          file,
          templateKey,
          template: templateByKey.get(templateKey) ?? null,
          signedArtifact: artifact,
          signedByUser: artifact
            ? (signerById.get(artifact.signedByUserId) ?? null)
            : null,
          sourcePdf: resolvedSource.sourcePdf,
          previewPageNumber: resolvedSource.previewPageNumber,
        },
      ]
    },
  )

  return {
    documentId: input.documentId,
    fileName: input.fileName,
    targets,
  }
}

const getBatchSigningDocument = async (
  batchId: string,
): Promise<SigningDocument> => {
  const db = getDb()
  const batches = await db
    .select()
    .from(intakeBatches)
    .where(and(eq(intakeBatches.id, batchId), isNull(intakeBatches.deletedAt)))
    .limit(1)
  const batch = batches.at(0) ?? null

  if (!batch) {
    throw new Error('Upload batch not found.')
  }

  if (batch.status !== 'closed') {
    throw new Error('Close this upload batch before signing certificates.')
  }

  const files = await db
    .select()
    .from(intakeFiles)
    .where(
      and(
        eq(intakeFiles.batchId, batch.id),
        isNull(intakeFiles.removedFromBatchAt),
        isNull(intakeFiles.purgeStatus),
      ),
    )

  if (files.length === 0) {
    throw new Error('No files were found in this upload batch.')
  }

  if (!isFileBatchReadyForSigning(files)) {
    throw new Error(BATCH_SIGNING_NOT_READY_MESSAGE)
  }

  const results = await db
    .select()
    .from(certificateResults)
    .where(
      inArray(
        certificateResults.uploadId,
        files.map((file) => file.id),
      ),
    )

  const readyCertificateResults = results
    .filter((result) => result.status === 'accepted')
    .sort((left, right) => {
      const leftFile = files.findIndex((file) => file.id === left.uploadId)
      const rightFile = files.findIndex((file) => file.id === right.uploadId)

      return leftFile - rightFile || left.id - right.id
    })

  if (readyCertificateResults.length === 0) {
    throw new Error('No ready certificate documents were found for this batch.')
  }

  return buildSigningDocumentFromResults({
    documentId: batch.id,
    fileName: batch.name?.trim() || `Upload batch ${batch.id}`,
    files,
    readyCertificateResults,
  })
}

const getSigningTarget = async (documentId: string): Promise<SigningTarget> => {
  const document = await getSigningDocument(documentId)

  if (isNumericDocumentId(documentId)) {
    const resultId = requireCertificateId(documentId)
    const target = document.targets.find(
      (candidate) => candidate.result.id === resultId,
    )
    if (!target) {
      throw new Error('Certificate not found.')
    }

    return target
  }

  return document.targets[0]
}

const toSigningContextView = (
  document: SigningDocument,
  profile: SignatureProfileView | null,
): SigningContextView => {
  return {
    documentId: document.documentId,
    fileName: document.fileName,
    certificateCount: document.targets.length,
    targets: document.targets.map<SigningTargetView>((target) => ({
      certificateId: String(target.result.id),
      fileName: target.result.artifactKey?.trim()
        ? toObjectFileName(target.result.artifactKey)
        : target.result.originalFileName.trim() || target.file.originalFileName,
      payee: extractPayee(target.result),
      certificatePageNumber: 1,
      sourcePdfUrl: toDocumentUrl(target.sourcePdf),
      signedPdfUrl: target.signedArtifact?.signedPdfKey
        ? toDocumentUrl({
            bucket: getStorageBucketName(),
            key: target.signedArtifact.signedPdfKey,
          })
        : undefined,
      previewPageNumber: target.previewPageNumber,
      templateKey: target.templateKey,
      signingStatus:
        target.signedArtifact?.status === 'failed'
          ? 'failed'
          : target.signedArtifact?.status === 'signed'
            ? 'signed'
            : 'unsigned',
      signedAt: toDisplayDate(target.signedArtifact?.signedAt),
      signedByName:
        target.signedByUser?.name || target.signedByUser?.email || undefined,
      hasSavedTemplatePlacement: Boolean(toTemplatePlacement(target)),
      templatePlacement: toTemplatePlacement(target),
    })),
    signatureProfile: profile,
  }
}

export const getSigningContext = async (
  documentId: string,
  userId: string,
): Promise<SigningContextView> => {
  const [document, profile] = await Promise.all([
    getSigningDocument(documentId),
    getSignatureProfile(userId),
  ])

  return toSigningContextView(document, profile)
}

export const getBatchSigningContext = async (
  batchId: string,
  userId: string,
): Promise<SigningContextView> => {
  const [document, profile] = await Promise.all([
    getBatchSigningDocument(batchId),
    getSignatureProfile(userId),
  ])

  return toSigningContextView(document, profile)
}

const snapshotSignatureProfile = (
  profile: SignatureProfileRecord,
): Omit<SignatureProfileView, 'signatureImageUrl' | 'updatedAt'> => ({
  displayName: profile.displayName,
  designation: profile.designation,
  tin: profile.tin,
  signatureImageKey: profile.signatureImageKey,
  signatureImageMimeType: profile.signatureImageMimeType as
    | 'image/png'
    | 'image/jpeg',
  signatureImageWidth: profile.signatureImageWidth,
  signatureImageHeight: profile.signatureImageHeight,
})

const drawTextLine = (
  page: PDFPage,
  text: string,
  rect: SignatureRect,
  fontSizeRect: SignatureRect,
  pageWidth: number,
  pageHeight: number,
  font: PDFFont,
) => {
  const pdfRect = toPdfRect(pageWidth, pageHeight, rect)
  let size = getSignatureTextFontSize(fontSizeRect, pageHeight)
  let textWidthAtSize = font.widthOfTextAtSize(text, size)

  if (textWidthAtSize > pdfRect.width && textWidthAtSize > 0) {
    size = Math.max(4, size * (pdfRect.width / textWidthAtSize))
    textWidthAtSize = font.widthOfTextAtSize(text, size)
  }

  page.drawText(text, {
    x: pdfRect.x + Math.max((pdfRect.width - textWidthAtSize) / 2, 0),
    y: pdfRect.y + Math.max((pdfRect.height - size) / 2, 0),
    size,
    font,
  })
}

const applySignatureToPdf = async (
  sourcePdf: ObjectLocation,
  placement: SignaturePlacementTemplate,
  profile: SignatureProfileRecord,
) => {
  const sourceBytes = await readS3ObjectBytes(sourcePdf)
  const pdfDoc = await PDFDocument.load(sourceBytes)
  const pageIndex = clamp(
    placement.pageNumber - 1,
    0,
    Math.max(pdfDoc.getPageCount() - 1, 0),
  )
  const page = pdfDoc.getPage(pageIndex)
  const { width, height } = page.getSize()
  const signatureBytes = await readS3ObjectBytes({
    bucket: getStorageBucketName(),
    key: profile.signatureImageKey,
  })
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const signatureImage =
    profile.signatureImageMimeType === 'image/png'
      ? await pdfDoc.embedPng(signatureBytes)
      : await pdfDoc.embedJpg(signatureBytes)

  const captionLayout = getSignatureCaptionLayoutRects(placement.signatureRect)
  const captionParts = [
    [profile.displayName, captionLayout.nameRect],
    ['/', captionLayout.firstSeparatorRect],
    [profile.designation, captionLayout.designationRect],
    ['/', captionLayout.secondSeparatorRect],
    [formatTinForDisplay(profile.tin), captionLayout.tinRect],
  ] as const
  for (const [text, rect] of captionParts) {
    drawTextLine(
      page,
      text,
      rect,
      placement.signatureRect,
      width,
      height,
      regularFont,
    )
  }

  const signatureImageRect = getDefaultSignatureImageRect(
    placement.signatureRect,
    profile.signatureImageWidth,
    profile.signatureImageHeight,
    width,
    height,
  )
  const signatureRect = toPdfRect(width, height, signatureImageRect)
  page.drawImage(signatureImage, {
    x: signatureRect.x,
    y: signatureRect.y,
    width: signatureRect.width,
    height: signatureRect.height,
  })

  return pdfDoc.save()
}

const persistFailedSigningAttempt = async (
  certificateId: number,
  signedByUserId: string,
  sourcePdf: ObjectLocation,
  profile: SignatureProfileRecord,
  placement: SignaturePlacementTemplate,
) => {
  const db = getDb()

  await db
    .insert(certificateSignedArtifacts)
    .values({
      certificateId,
      signedByUserId,
      signatureProfileSnapshot: snapshotSignatureProfile(profile),
      placementSnapshot: placement,
      sourcePdfKey: sourcePdf.key,
      signedPdfKey: null,
      status: 'failed',
      signedAt: null,
    })
    .onConflictDoUpdate({
      target: certificateSignedArtifacts.certificateId,
      set: {
        signedByUserId,
        signatureProfileSnapshot: snapshotSignatureProfile(profile),
        placementSnapshot: placement,
        sourcePdfKey: sourcePdf.key,
        signedPdfKey: null,
        status: 'failed',
        signedAt: null,
        updatedAt: new Date(),
      },
    })
}

const upsertTemplatePlacement = async (
  templateKey: string,
  userId: string,
  placement: SignaturePlacementTemplate,
) => {
  const db = getDb()

  await db
    .insert(certificateSignatureTemplates)
    .values({
      templateKey,
      pageNumber: placement.pageNumber,
      signatureRect: placement.signatureRect,
      nameRect: placement.nameRect,
      designationRect: placement.designationRect,
      tinRect: placement.tinRect,
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: certificateSignatureTemplates.templateKey,
      set: {
        pageNumber: placement.pageNumber,
        signatureRect: placement.signatureRect,
        nameRect: placement.nameRect,
        designationRect: placement.designationRect,
        tinRect: placement.tinRect,
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    })
}

const signResolvedTarget = async (input: {
  profile: SignatureProfileRecord
  request: SignCertificateTargetInput
  target: SigningTarget
  userId: string
  persistTemplatePlacement: boolean
}) => {
  const { profile, request, target, userId, persistTemplatePlacement } = input
  const placement = buildPlacementTemplate(
    request.pageNumber,
    request.signatureRect,
  )
  const signedArtifactId = randomUUID()
  const signedPdfKey = buildSignedPdfKey(
    target.result,
    target.file,
    signedArtifactId,
  )
  const signedPdf = {
    bucket: getStorageBucketName(),
    key: signedPdfKey,
  }

  if (persistTemplatePlacement) {
    await upsertTemplatePlacement(target.templateKey, userId, placement)
  }

  try {
    const db = getDb()
    const savedArtifact = await db.transaction(async (tx) => {
      const lockedFiles = await tx
        .select()
        .from(intakeFiles)
        .where(eq(intakeFiles.id, target.file.id))
        .for('update')
        .limit(1)
      const lockedFile = lockedFiles.at(0)
      if (
        !lockedFile ||
        lockedFile.removedFromBatchAt ||
        lockedFile.purgeStatus
      ) {
        const error = new Error(
          'This document is queued for permanent deletion and cannot be signed.',
        )
        error.name = 'SigningDeletionConflictError'
        throw error
      }

      const lockedBatches = await tx
        .select()
        .from(intakeBatches)
        .where(eq(intakeBatches.id, lockedFile.batchId))
        .for('update')
        .limit(1)
      if (lockedBatches.at(0)?.deletedAt) {
        const error = new Error('Recently Deleted batches cannot be signed.')
        error.name = 'SigningDeletionConflictError'
        throw error
      }

      const signedBytes = await applySignatureToPdf(
        target.sourcePdf,
        placement,
        profile,
      )
      await writeS3Object(signedPdf, signedBytes, 'application/pdf')

      const [saved] = await tx
        .insert(certificateSignedArtifacts)
        .values({
          id: signedArtifactId,
          certificateId: target.result.id,
          signedByUserId: userId,
          signatureProfileSnapshot: snapshotSignatureProfile(profile),
          placementSnapshot: placement,
          sourcePdfKey: target.sourcePdf.key,
          signedPdfKey,
          status: 'signed',
          signedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: certificateSignedArtifacts.certificateId,
          set: {
            signedByUserId: userId,
            signatureProfileSnapshot: snapshotSignatureProfile(profile),
            placementSnapshot: placement,
            sourcePdfKey: target.sourcePdf.key,
            signedPdfKey,
            status: 'signed',
            signedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning()
      return saved
    })

    const signerRows = await db
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.id, userId))
      .limit(1)
    const signer = signerRows.at(0) ?? null

    return {
      certificateId: String(target.result.id),
      status: 'signed' as const,
      signedAt: toDisplayDate(savedArtifact.signedAt),
      signedByName:
        signer === null ? undefined : signer.name || signer.email || undefined,
      signedPdfUrl: toDocumentUrl(signedPdf),
      templatePlacement: placement,
    }
  } catch (error) {
    if (
      !(error instanceof Error && error.name === 'SigningDeletionConflictError')
    ) {
      await persistFailedSigningAttempt(
        target.result.id,
        userId,
        target.sourcePdf,
        profile,
        placement,
      )
    }
    throw error
  }
}

const areSameSignatureRect = (left: SignatureRect, right: SignatureRect) =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

const resolveSigningTiming = (
  input: SignCertificateRequest,
  requestStartedAt: Date,
) => {
  const serverRequestTiming = {
    startedAt: requestStartedAt,
    timingSource: 'server_request',
  }
  if (!input.signingStartedAt) return serverRequestTiming

  const clientStartedAt = new Date(input.signingStartedAt)
  if (
    Number.isNaN(clientStartedAt.getTime()) ||
    clientStartedAt > requestStartedAt
  ) {
    return serverRequestTiming
  }

  return {
    startedAt: clientStartedAt,
    timingSource: 'client_interaction',
  }
}

export const signCertificateDocument = async (
  documentId: string,
  userId: string,
  input: SignCertificateRequest,
) => {
  const requestStartedAt = new Date()
  const [target, profile] = await Promise.all([
    getSigningTarget(documentId),
    getSignatureProfileRecord(userId),
  ])

  if (profile === null) {
    throw new Error('Save your signature profile before signing a certificate.')
  }

  const request = input.targets[0]

  const signedArtifact = await signResolvedTarget({
    profile,
    request,
    target,
    userId,
    persistTemplatePlacement: true,
  })

  const timing = resolveSigningTiming(input, requestStartedAt)

  await recordBatchStageTiming({
    batchId: target.result.batchId,
    stage: 'signing',
    startedAt: timing.startedAt,
    finishedAt: new Date(),
    dedupeKey: `signing:${target.result.batchId}:${target.result.id}:${requestStartedAt.toISOString()}`,
    sourceType: 'document_signing',
    sourceId: String(target.result.id),
    metadata: {
      certificateId: target.result.id,
      signedCount: 1,
      timingSource: timing.timingSource,
    },
  }).catch(logBatchStageTimingError)

  return signedArtifact
}

export const signDocumentCertificates = async (
  documentId: string,
  userId: string,
  input: SignCertificateRequest,
) => {
  const [document, profile] = await Promise.all([
    getSigningDocument(documentId),
    getSignatureProfileRecord(userId),
  ])

  return signResolvedDocumentCertificates(document, userId, input, profile)
}

const signResolvedDocumentCertificates = async (
  document: SigningDocument,
  userId: string,
  input: SignCertificateRequest,
  profile: SignatureProfileRecord | null,
  options: { allowResign?: boolean } = {},
) => {
  if (profile === null) {
    throw new Error('Save your signature profile before signing certificates.')
  }

  const isResignRequest = input.resign === true
  if (isResignRequest && !options.allowResign) {
    throw new Error('Re-signing is available from closed upload batches only.')
  }

  const targetById = new Map(
    document.targets.map((target) => [String(target.result.id), target]),
  )

  const pendingRequests = input.targets.flatMap((request) => {
    const target = targetById.get(request.certificateId)
    if (!target) {
      throw new Error('One or more certificates could not be found.')
    }

    if (target.signedArtifact?.status === 'signed' && !isResignRequest) {
      return []
    }

    return [{ request, target }]
  })

  if (pendingRequests.length === 0) {
    throw new Error(
      isResignRequest
        ? 'No certificates were selected for re-signing.'
        : 'All certificates are already signed.',
    )
  }

  const firstRequest = pendingRequests[0].request
  const persistTemplatePlacement =
    pendingRequests.length === 1 ||
    pendingRequests.every(
      ({ request }) =>
        request.pageNumber === firstRequest.pageNumber &&
        areSameSignatureRect(request.signatureRect, firstRequest.signatureRect),
    )

  const signedArtifacts = []
  for (const pending of pendingRequests) {
    signedArtifacts.push(
      await signResolvedTarget({
        profile,
        request: pending.request,
        target: pending.target,
        userId,
        persistTemplatePlacement,
      }),
    )
  }

  return signedArtifacts
}

export const signBatchCertificates = async (
  batchId: string,
  userId: string,
  input: SignCertificateRequest,
) => {
  const requestStartedAt = new Date()
  const document = await getBatchSigningDocument(batchId)
  const signedArtifacts = await signResolvedDocumentCertificates(
    document,
    userId,
    input,
    await getSignatureProfileRecord(userId),
    { allowResign: true },
  )

  const timing = resolveSigningTiming(input, requestStartedAt)

  await recordBatchStageTiming({
    batchId,
    stage: 'signing',
    startedAt: timing.startedAt,
    finishedAt: new Date(),
    dedupeKey: `signing:${batchId}:${requestStartedAt.toISOString()}`,
    sourceType: 'batch_signing',
    sourceId: batchId,
    metadata: {
      signedCount: signedArtifacts.length,
      resigned: input.resign === true,
      timingSource: timing.timingSource,
    },
  }).catch(logBatchStageTimingError)

  return signedArtifacts
}

export const getSigningSummaries = async (
  resultIds: Array<number>,
): Promise<Map<number, SigningSummaryRecord>> => {
  if (resultIds.length === 0) {
    return new Map()
  }

  const db = getDb()
  const artifacts = await db
    .select()
    .from(certificateSignedArtifacts)
    .where(inArray(certificateSignedArtifacts.certificateId, resultIds))
  const signerIds = Array.from(
    new Set(artifacts.map((artifact) => artifact.signedByUserId)),
  )
  const signers =
    signerIds.length === 0
      ? []
      : await db
          .select()
          .from(authUserTable)
          .where(inArray(authUserTable.id, signerIds))

  const signerById = new Map(signers.map((signer) => [signer.id, signer]))

  return new Map(
    artifacts.map((artifact) => {
      const signingStatus: SigningSummaryRecord['signingStatus'] =
        artifact.status === 'failed'
          ? 'failed'
          : artifact.status === 'signed'
            ? 'signed'
            : 'unsigned'

      return [
        artifact.certificateId,
        {
          signingStatus,
          signedAt: toDisplayDate(artifact.signedAt),
          signedByName:
            signerById.get(artifact.signedByUserId)?.name ||
            signerById.get(artifact.signedByUserId)?.email ||
            undefined,
          signedPdfUrl:
            artifact.signedPdfKey && artifact.status === 'signed'
              ? toDocumentUrl({
                  bucket: getStorageBucketName(),
                  key: artifact.signedPdfKey,
                })
              : undefined,
        },
      ]
    }),
  )
}

export const getSignedCertificatePdfDownload = async (
  documentId: string,
  downloaderUserId?: string,
) => {
  const db = getDb()
  const resultRows = isNumericDocumentId(documentId)
    ? await db
        .select()
        .from(certificateResults)
        .where(eq(certificateResults.id, requireCertificateId(documentId)))
        .limit(1)
    : await db
        .select()
        .from(certificateResults)
        .where(eq(certificateResults.uploadId, documentId))
  const result = resultRows.at(0) ?? null

  const successfulResults = resultRows.filter(
    (candidate) => candidate.status === 'accepted',
  )

  if (result === null || successfulResults.length === 0) {
    throw new Error('Signed certificate not found.')
  }

  const artifactRows = await db
    .select()
    .from(certificateSignedArtifacts)
    .where(
      inArray(
        certificateSignedArtifacts.certificateId,
        successfulResults.map((candidate) => candidate.id),
      ),
    )
  const signedArtifact = artifactRows.find(
    (candidate) => candidate.status === 'signed' && candidate.signedPdfKey,
  )
  const signedResult =
    signedArtifact === undefined
      ? undefined
      : successfulResults.find(
          (candidate) => candidate.id === signedArtifact.certificateId,
        )

  if (
    signedArtifact === undefined ||
    signedResult === undefined ||
    !signedArtifact.signedPdfKey
  ) {
    throw new Error('Signed PDF is not available for this certificate.')
  }

  const bytes = await readS3ObjectBytes({
    bucket: getStorageBucketName(),
    key: signedArtifact.signedPdfKey,
  })
  const downloadedAt = new Date()
  const downloadPatch = {
    firstDownloadedAt: sql`coalesce(${certificateSignedArtifacts.firstDownloadedAt}, ${downloadedAt})`,
    lastDownloadedAt: downloadedAt,
    downloadCount: sql`${certificateSignedArtifacts.downloadCount} + 1`,
    ...(downloaderUserId
      ? {
          firstDownloadedByUserId: sql`coalesce(${certificateSignedArtifacts.firstDownloadedByUserId}, ${downloaderUserId})`,
        }
      : {}),
    updatedAt: downloadedAt,
  }

  await db
    .update(certificateSignedArtifacts)
    .set(downloadPatch)
    .where(eq(certificateSignedArtifacts.id, signedArtifact.id))

  return {
    bytes,
    contentType: 'application/pdf',
    fileName: toObjectFileName(
      signedResult.artifactKey?.trim() || signedArtifact.signedPdfKey,
    ),
  }
}

type SignedBatchCertificatesZipDownloadInput = {
  batchId: string
  downloaderUserId?: string
}

export const getSignedBatchCertificatesZipDownload = async ({
  batchId,
  downloaderUserId,
}: SignedBatchCertificatesZipDownloadInput) => {
  const db = getDb()
  const batchRows = await db
    .select()
    .from(intakeBatches)
    .where(and(eq(intakeBatches.id, batchId), isNull(intakeBatches.deletedAt)))
    .limit(1)
  const batch = batchRows.at(0) ?? null

  if (!batch) {
    throw new Error('Upload batch not found.')
  }

  if (batch.status !== 'closed') {
    throw new Error(
      'Close this upload batch before downloading signed certificates.',
    )
  }

  const files = await db
    .select()
    .from(intakeFiles)
    .where(
      and(
        eq(intakeFiles.batchId, batch.id),
        isNull(intakeFiles.removedFromBatchAt),
        isNull(intakeFiles.purgeStatus),
      ),
    )

  if (files.length === 0) {
    throw new Error('No signed certificate PDFs were found for this batch.')
  }

  const activeUploadIds = new Set(files.map((file) => file.id))
  const results = await db
    .select()
    .from(certificateResults)
    .where(
      inArray(
        certificateResults.uploadId,
        files.map((file) => file.id),
      ),
    )
  const readyResults = results
    .filter(
      (result) =>
        result.status === 'accepted' && activeUploadIds.has(result.uploadId),
    )
    .sort((left, right) => {
      const leftFile = files.findIndex((file) => file.id === left.uploadId)
      const rightFile = files.findIndex((file) => file.id === right.uploadId)

      return leftFile - rightFile || left.id - right.id
    })

  if (readyResults.length === 0) {
    throw new Error('No signed certificate PDFs were found for this batch.')
  }

  const artifacts = await db
    .select()
    .from(certificateSignedArtifacts)
    .where(
      inArray(
        certificateSignedArtifacts.certificateId,
        readyResults.map((result) => result.id),
      ),
    )
  const signedArtifactByResultId = new Map(
    artifacts
      .filter(
        (artifact) => artifact.status === 'signed' && artifact.signedPdfKey,
      )
      .map((artifact) => [artifact.certificateId, artifact]),
  )
  const signedDownloads = readyResults.flatMap((result) => {
    const artifact = signedArtifactByResultId.get(result.id)
    if (!artifact?.signedPdfKey) {
      return []
    }

    return [{ result, artifact }]
  })

  if (signedDownloads.length === 0) {
    throw new Error('No signed certificate PDFs were found for this batch.')
  }

  const usedEntryNames = new Set<string>()
  const entries: Record<string, Uint8Array> = {}

  await Promise.all(
    signedDownloads.map(async ({ result, artifact }) => {
      if (!artifact.signedPdfKey) {
        return
      }

      const entryName = buildSignedCertificateZipEntryName(
        result.artifactKey?.trim() || artifact.signedPdfKey,
        usedEntryNames,
      )
      entries[entryName] = await readS3ObjectBytes({
        bucket: getStorageBucketName(),
        key: artifact.signedPdfKey,
      })
    }),
  )

  const zipBytes = zipSync(entries)
  const downloadedAt = new Date()
  const downloadPatch = {
    firstDownloadedAt: sql`coalesce(${certificateSignedArtifacts.firstDownloadedAt}, ${downloadedAt})`,
    lastDownloadedAt: downloadedAt,
    downloadCount: sql`${certificateSignedArtifacts.downloadCount} + 1`,
    ...(downloaderUserId
      ? {
          firstDownloadedByUserId: sql`coalesce(${certificateSignedArtifacts.firstDownloadedByUserId}, ${downloaderUserId})`,
        }
      : {}),
    updatedAt: downloadedAt,
  }

  await db
    .update(certificateSignedArtifacts)
    .set(downloadPatch)
    .where(
      inArray(
        certificateSignedArtifacts.id,
        signedDownloads.map(({ artifact }) => artifact.id),
      ),
    )

  return {
    bytes: zipBytes,
    contentType: 'application/zip',
    fileName: buildSignedBatchCertificatesZipFileName(batch),
    signedCount: signedDownloads.length,
  }
}

export const getTemplatePlacementMap = async (
  files: Array<IntakeFileRecord>,
) => {
  if (files.length === 0) {
    return new Map<string, boolean>()
  }

  const templateKeys = Array.from(
    new Set(files.map((file) => buildTemplateKey(file))),
  )
  const db = getDb()
  const templates = await db
    .select()
    .from(certificateSignatureTemplates)
    .where(inArray(certificateSignatureTemplates.templateKey, templateKeys))

  const available = new Map<string, boolean>()
  for (const key of templateKeys) {
    available.set(key, false)
  }
  for (const template of templates) {
    available.set(template.templateKey, true)
  }

  return available
}

export const getTemplateKeyForFile = buildTemplateKey
