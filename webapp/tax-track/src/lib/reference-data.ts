import { z } from 'zod'

import { normalizeTinDigits } from '@taxtrack/shared/utils/tin'

export const referenceDataDatasets = [
  'masterlist',
  'entities',
  'atc-codes',
] as const

export type ReferenceDataDataset = (typeof referenceDataDatasets)[number]

export const REFERENCE_DATA_MAX_FILE_BYTES = 10 * 1024 * 1024
export const REFERENCE_DATA_MAX_ROWS = 100_000
export const REFERENCE_DATA_DEFAULT_PAGE_SIZE = 25
export const REFERENCE_DATA_MAX_PAGE_SIZE = 100

const normalizeNullableText = (value: string | null | undefined) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const nullableText = (maxLength = 5_000) =>
  z
    .union([z.string().max(maxLength), z.null(), z.undefined()])
    .transform(normalizeNullableText)

const nullableTin = z
  .union([z.string().max(64), z.null(), z.undefined()])
  .transform((value) => normalizeTinDigits(value))

export const masterlistRowInputSchema = z.object({
  region: nullableText(255),
  entity: nullableText(255),
  shortName: nullableText(255),
  customerName: nullableText(1_000),
  tin: nullableTin,
  address: nullableText(),
  emailAddress: nullableText(1_000),
  isGovernment: z.boolean().default(false),
})

export const entityRowInputSchema = z.object({
  shortName: nullableText(255),
  companyName: nullableText(1_000),
  birRegisteredAddress: nullableText(),
  zipCode: nullableText(32),
  tin: nullableTin,
  emailAddress: nullableText(1_000),
  regionEmailAddress: nullableText(1_000),
})

export const atcCodeRowInputSchema = z.object({
  taxType: z.string().trim().min(1, 'Tax type is required.').max(255),
  code: z
    .string()
    .transform((value) =>
      value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/gu, ''),
    )
    .pipe(z.string().min(1, 'ATC code is required.').max(32)),
  description: z.string().trim().min(1, 'Description is required.').max(5_000),
  rate: z.coerce.number().positive('Tax rate must be positive.'),
})

export type MasterlistRowInput = z.infer<typeof masterlistRowInputSchema>
export type EntityRowInput = z.infer<typeof entityRowInputSchema>
export type AtcCodeRowInput = z.infer<typeof atcCodeRowInputSchema>

export type MasterlistReferenceRow = MasterlistRowInput & { id: number }
export type EntityReferenceRow = EntityRowInput & { id: number }
export type AtcCodeReferenceRow = AtcCodeRowInput & { id: number }

export type ReferenceDataRow =
  | MasterlistReferenceRow
  | EntityReferenceRow
  | AtcCodeReferenceRow

export const referenceDataDefinitions = {
  masterlist: {
    label: 'Masterlist',
    singularLabel: 'masterlist row',
    importUrl: '/api/masterlist/import',
    headers: [
      'REGION',
      'ENTITY',
      'Short Name',
      'CUSTOMER NAME',
      'TIN',
      'Address',
      'Email Address',
    ],
  },
  entities: {
    label: 'Entities',
    singularLabel: 'entity',
    importUrl: '/api/entities/import',
    headers: [
      'Short Name',
      'Company Name',
      'BIR Registered Address',
      'ZIP Code',
      'TIN',
      'EMAIL ADDRESS',
      'REGION',
    ],
  },
  'atc-codes': {
    label: 'ATC Codes',
    singularLabel: 'ATC code',
    importUrl: '/api/atc-codes/import',
    headers: ['Tax Type', 'ATC', 'Description', 'Tax Rate'],
  },
} as const satisfies Record<
  ReferenceDataDataset,
  {
    label: string
    singularLabel: string
    importUrl: string
    headers: ReadonlyArray<string>
  }
>

export const isReferenceDataDataset = (
  value: unknown,
): value is ReferenceDataDataset =>
  typeof value === 'string' &&
  referenceDataDatasets.includes(value as ReferenceDataDataset)

export const getReferenceDataInputSchema = (dataset: ReferenceDataDataset) => {
  switch (dataset) {
    case 'masterlist':
      return masterlistRowInputSchema
    case 'entities':
      return entityRowInputSchema
    case 'atc-codes':
      return atcCodeRowInputSchema
  }
}

export const assertReferenceDataRowLimit = (rowCount: number) => {
  if (rowCount > REFERENCE_DATA_MAX_ROWS) {
    throw new Error(
      `CSV files may contain at most ${REFERENCE_DATA_MAX_ROWS.toLocaleString()} data rows.`,
    )
  }
}
