import { z } from 'zod'

const normalizedCoordinateSchema = z.number().min(0).max(1)

export const signatureRectSchema = z
  .object({
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .superRefine((value, context) => {
    if (value.x + value.width > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['width'],
        message: 'Signature block must stay within the page width.',
      })
    }

    if (value.y + value.height > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['height'],
        message: 'Signature block must stay within the page height.',
      })
    }
  })

export const signatureImageMimeTypeSchema = z.enum(['image/png', 'image/jpeg'])

export const signaturePlacementTemplateSchema = z.object({
  pageNumber: z.number().int().positive(),
  signatureRect: signatureRectSchema,
  signatureImageRect: signatureRectSchema.optional(),
  nameRect: signatureRectSchema,
  designationRect: signatureRectSchema,
  tinRect: signatureRectSchema,
})

export const signatureProfileViewSchema = z.object({
  displayName: z.string(),
  designation: z.string(),
  tin: z.string(),
  signatureImageKey: z.string(),
  signatureImageUrl: z.string(),
  signatureImageMimeType: signatureImageMimeTypeSchema,
  signatureImageWidth: z.number().int().positive(),
  signatureImageHeight: z.number().int().positive(),
  updatedAt: z.string().optional(),
})

export const signedArtifactViewSchema = z.object({
  documentResultId: z.string(),
  status: z.enum(['unsigned', 'signed', 'failed']),
  signedAt: z.string().optional(),
  signedByName: z.string().optional(),
  signedPdfUrl: z.string().optional(),
  templatePlacement: signaturePlacementTemplateSchema.optional(),
})

export const signingTargetViewSchema = z.object({
  documentResultId: z.string(),
  fileName: z.string(),
  payee: z.string(),
  certificatePageNumber: z.number().int().positive(),
  sourcePdfUrl: z.string(),
  signedPdfUrl: z.string().optional(),
  previewPageNumber: z.number().int().positive(),
  templateKey: z.string(),
  signingStatus: z.enum(['unsigned', 'signed', 'failed']),
  signedAt: z.string().optional(),
  signedByName: z.string().optional(),
  hasSavedTemplatePlacement: z.boolean(),
  templatePlacement: signaturePlacementTemplateSchema.nullable(),
})

export const signingContextViewSchema = z.object({
  documentId: z.string(),
  fileName: z.string(),
  certificateCount: z.number().int().positive(),
  targets: z.array(signingTargetViewSchema).min(1),
  signatureProfile: signatureProfileViewSchema.nullable(),
})

export const signatureProfileUpsertSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Name is required.'),
    designation: z.string().trim().min(1, 'Designation is required.'),
    tin: z.string().trim().min(1, 'TIN is required.'),
    signatureImageDataUrl: z.string().trim().optional(),
    signatureImageMimeType: signatureImageMimeTypeSchema.optional(),
    signatureImageWidth: z.coerce
      .number()
      .int()
      .positive('Signature width is required.')
      .optional(),
    signatureImageHeight: z.coerce
      .number()
      .int()
      .positive('Signature height is required.')
      .optional(),
  })
  .superRefine((value, context) => {
    if (!value.signatureImageDataUrl) {
      return
    }

    if (!value.signatureImageMimeType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signatureImageMimeType'],
        message: 'Signature image type is required.',
      })
    }

    if (!value.signatureImageWidth) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signatureImageWidth'],
        message: 'Signature image width is required.',
      })
    }

    if (!value.signatureImageHeight) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signatureImageHeight'],
        message: 'Signature image height is required.',
      })
    }
  })

export const signCertificateTargetSchema = z.object({
  documentResultId: z.string(),
  pageNumber: z.number().int().positive(),
  signatureRect: signatureRectSchema,
  signatureImageRect: signatureRectSchema.optional(),
})

export const signCertificateRequestSchema = z.object({
  resign: z.boolean().optional().default(false),
  signingStartedAt: z.string().datetime({ offset: true }).optional(),
  targets: z.array(signCertificateTargetSchema).min(1),
})

export type SignatureRect = z.infer<typeof signatureRectSchema>
export type SignaturePlacementTemplate = z.infer<
  typeof signaturePlacementTemplateSchema
>
export type SignatureProfileView = z.infer<typeof signatureProfileViewSchema>
export type SignedArtifactView = z.infer<typeof signedArtifactViewSchema>
export type SigningTargetView = z.infer<typeof signingTargetViewSchema>
export type SigningContextView = z.infer<typeof signingContextViewSchema>
export type SignatureProfileUpsertInput = z.infer<
  typeof signatureProfileUpsertSchema
>
export type SignCertificateTargetInput = z.infer<
  typeof signCertificateTargetSchema
>
export type SignCertificateRequest = z.infer<
  typeof signCertificateRequestSchema
>
export type SigningStatus = SignedArtifactView['status']
