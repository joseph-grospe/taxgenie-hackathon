import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildSignatureProfileImageKey,
  buildSignedCertificateKey,
} from '@taxtrack/shared'
import {
  formatTinForDisplay,
  normalizeTinDigits,
} from '@taxtrack/shared/utils/tin'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { EntityStorageInput } from '@taxtrack/shared'
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
import {
  fitRectWithinRect,
  getDefaultSignatureImageRect,
} from '@/lib/signing-placement'

import {
  logBatchStageTimingError,
  recordBatchStageTiming,
} from '@/lib/batch-stage-timing-server'
import { getDb } from '@/lib/db'
import {
  authUserTable,
  certificateSignatureTemplates,
  certificateSignedArtifacts,
  documentResults,
  intakeBatches,
  intakeFiles,
  reconciliationResults,
  userSignatureProfiles,
} from '@/lib/schema'
import { resolveOverallStatus } from '@/lib/intake-utils'
import {
  createS3ServerClient,
  getStorageBucketName,
  getStoragePrefix,
} from '@/lib/aws-server'

type DocumentResultRecord = typeof documentResults.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect
type SignatureProfileRecord = typeof userSignatureProfiles.$inferSelect
type SignatureTemplateRecord = typeof certificateSignatureTemplates.$inferSelect
type SignedArtifactRecord = typeof certificateSignedArtifacts.$inferSelect
type UserRecord = typeof authUserTable.$inferSelect

type SigningTarget = {
  result: DocumentResultRecord
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

const requireDocumentResultId = (documentId: string) => {
  if (!isNumericDocumentId(documentId)) {
    throw new Error('Certificate not found.')
  }

  return Number.parseInt(documentId, 10)
}

const ensureReadyCertificate = (result: DocumentResultRecord) => {
  if (result.status !== 'success') {
    throw new Error('Only ready certificate documents can be signed.')
  }
}

const blocksBatchSigning = (file: IntakeFileRecord) =>
  ['pending', 'uploaded', 'queued', 'processing'].includes(
    resolveOverallStatus(file),
  )

const assertAllCertificatesReconciled = async (
  readyCertificateResults: Array<DocumentResultRecord>,
) => {
  const db = getDb()
  const resultIds = readyCertificateResults.map((result) => result.id)
  const rows =
    resultIds.length === 0
      ? []
      : await db
          .select({
            matchedTaxRecordId: reconciliationResults.matchedTaxRecordId,
            matchStatus: reconciliationResults.matchStatus,
          })
          .from(reconciliationResults)
          .where(inArray(reconciliationResults.matchedTaxRecordId, resultIds))
  const reconciledResultIds = new Set(
    rows.flatMap((row) =>
      row.matchStatus === 'matched' && row.matchedTaxRecordId !== null
        ? [row.matchedTaxRecordId]
        : [],
    ),
  )

  if (reconciledResultIds.size !== readyCertificateResults.length) {
    throw new Error(
      'Reconcile all ready certificate documents before signing this batch.',
    )
  }
}

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
  result: DocumentResultRecord,
  file: IntakeFileRecord,
  signedArtifactId: string,
) => {
  return buildSignedCertificateKey({
    prefix: getStoragePrefix(),
    entityKey: getResultEntityKey(result),
    customerKey: getResultCustomerKey(result),
    period: result.periodEnd ?? 'period-unknown',
    batchId: file.batchId,
    documentResultId: result.id,
    signedArtifactId,
  })
}

const getResultEntityKey = (result: DocumentResultRecord) => {
  const payload = result.payload as {
    event?: {
      selectedEntity?: EntityStorageInput
    }
  }
  const entity = payload.event?.selectedEntity
  return buildOptionalEntityStorageKey(entity)
}

const getResultCustomerKey = (result: DocumentResultRecord) =>
  buildOptionalCustomerStorageKey({
    shortName: result.payorShortName,
  })

const decodeSignatureImage = (input: string) => {
  const match = input.trim().match(SIGNATURE_IMAGE_PATTERN)
  if (!match) {
    throw new Error('Signature image must be a PNG or JPEG data URL.')
  }

  return {
    mimeType: match[1] as 'image/png' | 'image/jpeg',
    bytes: Uint8Array.from(Buffer.from(match[2].replace(/\s+/g, ''), 'base64')),
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

const buildTextRect = (
  blockRect: SignatureRect,
  relativeY: number,
  relativeHeight: number,
): SignatureRect => ({
  x: blockRect.x,
  y: clamp(blockRect.y + relativeY * blockRect.height, 0, 1),
  width: blockRect.width,
  height: clamp(relativeHeight * blockRect.height, 0.01, 1),
})

export const buildPlacementTemplate = (
  pageNumber: number,
  signatureRect: SignatureRect,
  signatureImageRect?: SignatureRect,
): SignaturePlacementTemplate => ({
  pageNumber,
  signatureRect,
  signatureImageRect,
  nameRect: buildTextRect(signatureRect, 0.62, 0.12),
  designationRect: buildTextRect(signatureRect, 0.77, 0.1),
  tinRect: buildTextRect(signatureRect, 0.89, 0.09),
})

const buildSignatureCaption = (profile: SignatureProfileRecord) =>
  `${profile.displayName}       /       ${profile.designation}       /       ${formatTinForDisplay(profile.tin)}`

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
  result: DocumentResultRecord,
  file: IntakeFileRecord,
) => {
  const resultsBucket = getStorageBucketName()

  if (
    typeof result.finalKey === 'string' &&
    result.finalKey.trim().length > 0
  ) {
    return {
      sourcePdf: {
        bucket: resultsBucket,
        key: result.finalKey,
      },
      previewPageNumber: 1,
    }
  }

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

const extractPayee = (payload: unknown) => {
  if (!isRecord(payload) || !isRecord(payload.normalized)) {
    return 'Unknown payee'
  }

  const payeeName =
    typeof payload.normalized.payeeName === 'string'
      ? payload.normalized.payeeName.trim()
      : ''
  const companyName =
    typeof payload.normalized.companyName === 'string'
      ? payload.normalized.companyName.trim()
      : ''

  return payeeName || companyName || 'Unknown payee'
}

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
    const resultId = requireDocumentResultId(documentId)
    const resultRows = await db
      .select()
      .from(documentResults)
      .where(eq(documentResults.id, resultId))
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
    .from(documentResults)
    .where(eq(documentResults.uploadId, file.id))

  const readyCertificateResults = results
    .filter((result) => result.status === 'success')
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
  readyCertificateResults: Array<DocumentResultRecord>
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
          certificateSignedArtifacts.documentResultId,
          input.readyCertificateResults.map((result) => result.id),
        ),
      ),
  ])

  const templateByKey = new Map(
    templates.map((template) => [template.templateKey, template]),
  )
  const artifactByResultId = new Map(
    artifacts.map((artifact) => [artifact.documentResultId, artifact]),
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
  userId: string,
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

  if (batch.createdByUserId !== userId) {
    throw new Error('You do not have permission to sign this upload batch.')
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
      ),
    )

  if (files.some((file) => blocksBatchSigning(file))) {
    throw new Error(
      'Wait for all pending, uploaded, queued, or processing files to finish before signing this batch.',
    )
  }

  if (files.length === 0) {
    throw new Error('No files were found in this upload batch.')
  }

  const results = await db
    .select()
    .from(documentResults)
    .where(
      inArray(
        documentResults.uploadId,
        files.map((file) => file.id),
      ),
    )

  const readyCertificateResults = results
    .filter((result) => result.status === 'success')
    .sort((left, right) => {
      const leftFile = files.findIndex((file) => file.id === left.uploadId)
      const rightFile = files.findIndex((file) => file.id === right.uploadId)

      return leftFile - rightFile || left.id - right.id
    })

  if (readyCertificateResults.length === 0) {
    throw new Error('No ready certificate documents were found for this batch.')
  }

  await assertAllCertificatesReconciled(readyCertificateResults)

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
    const resultId = requireDocumentResultId(documentId)
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
      documentResultId: String(target.result.id),
      fileName:
        target.result.finalKey && target.result.finalKey.trim().length > 0
          ? toObjectFileName(target.result.finalKey)
          : target.result.originalFileName?.trim() ||
            target.file.originalFileName,
      payee: extractPayee(target.result.payload),
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
    getBatchSigningDocument(batchId, userId),
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
  pageWidth: number,
  pageHeight: number,
  font: PDFFont,
) => {
  const pdfRect = toPdfRect(pageWidth, pageHeight, rect)
  const maxSizeByHeight = clamp(pdfRect.height * 0.3, 5, 7.5)
  let size = maxSizeByHeight
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

  const signatureImageRect = fitRectWithinRect(
    placement.signatureImageRect ??
      getDefaultSignatureImageRect(
        placement.signatureRect,
        profile.signatureImageWidth,
        profile.signatureImageHeight,
      ),
    profile.signatureImageWidth,
    profile.signatureImageHeight,
  )
  const signatureRect = toPdfRect(width, height, signatureImageRect)
  page.drawImage(signatureImage, {
    x: signatureRect.x,
    y: signatureRect.y,
    width: signatureRect.width,
    height: signatureRect.height,
  })
  drawTextLine(
    page,
    buildSignatureCaption(profile),
    placement.signatureRect,
    width,
    height,
    regularFont,
  )

  return pdfDoc.save()
}

const persistFailedSigningAttempt = async (
  documentResultId: number,
  signedByUserId: string,
  sourcePdf: ObjectLocation,
  profile: SignatureProfileRecord,
  placement: SignaturePlacementTemplate,
) => {
  const db = getDb()

  await db
    .insert(certificateSignedArtifacts)
    .values({
      documentResultId,
      signedByUserId,
      signatureProfileSnapshot: snapshotSignatureProfile(profile),
      placementSnapshot: placement,
      sourcePdfKey: sourcePdf.key,
      signedPdfKey: null,
      status: 'failed',
      signedAt: null,
    })
    .onConflictDoUpdate({
      target: certificateSignedArtifacts.documentResultId,
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
    request.signatureImageRect,
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
    const signedBytes = await applySignatureToPdf(
      target.sourcePdf,
      placement,
      profile,
    )
    await writeS3Object(signedPdf, signedBytes, 'application/pdf')

    const db = getDb()
    const [savedArtifact] = await db
      .insert(certificateSignedArtifacts)
      .values({
        id: signedArtifactId,
        documentResultId: target.result.id,
        signedByUserId: userId,
        signatureProfileSnapshot: snapshotSignatureProfile(profile),
        placementSnapshot: placement,
        sourcePdfKey: target.sourcePdf.key,
        signedPdfKey,
        status: 'signed',
        signedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: certificateSignedArtifacts.documentResultId,
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

    const signerRows = await db
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.id, userId))
      .limit(1)
    const signer = signerRows.at(0) ?? null

    return {
      documentResultId: String(target.result.id),
      status: 'signed' as const,
      signedAt: toDisplayDate(savedArtifact.signedAt),
      signedByName:
        signer === null ? undefined : signer.name || signer.email || undefined,
      signedPdfUrl: toDocumentUrl(signedPdf),
      templatePlacement: placement,
    }
  } catch (error) {
    await persistFailedSigningAttempt(
      target.result.id,
      userId,
      target.sourcePdf,
      profile,
      placement,
    )
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
      documentResultId: target.result.id,
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
    const target = targetById.get(request.documentResultId)
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
  const hasCustomSignatureImagePlacement = pendingRequests.some(
    ({ request }) => {
      const defaultSignatureImageRect = getDefaultSignatureImageRect(
        request.signatureRect,
        profile.signatureImageWidth,
        profile.signatureImageHeight,
      )

      return (
        request.signatureImageRect !== undefined &&
        !areSameSignatureRect(
          request.signatureImageRect,
          defaultSignatureImageRect,
        )
      )
    },
  )
  const persistTemplatePlacement =
    !hasCustomSignatureImagePlacement &&
    (pendingRequests.length === 1 ||
      pendingRequests.every(
        ({ request }) =>
          request.pageNumber === firstRequest.pageNumber &&
          areSameSignatureRect(
            request.signatureRect,
            firstRequest.signatureRect,
          ),
      ))

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
  const document = await getBatchSigningDocument(batchId, userId)
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
    .where(inArray(certificateSignedArtifacts.documentResultId, resultIds))
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
        artifact.documentResultId,
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
        .from(documentResults)
        .where(eq(documentResults.id, requireDocumentResultId(documentId)))
        .limit(1)
    : await db
        .select()
        .from(documentResults)
        .where(eq(documentResults.uploadId, documentId))
  const result = resultRows.at(0) ?? null

  const successfulResults = resultRows.filter(
    (candidate) => candidate.status === 'success',
  )

  if (result === null || successfulResults.length === 0) {
    throw new Error('Signed certificate not found.')
  }

  const artifactRows = await db
    .select()
    .from(certificateSignedArtifacts)
    .where(
      inArray(
        certificateSignedArtifacts.documentResultId,
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
          (candidate) => candidate.id === signedArtifact.documentResultId,
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
      signedResult.finalKey?.trim() || signedArtifact.signedPdfKey,
    ),
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
