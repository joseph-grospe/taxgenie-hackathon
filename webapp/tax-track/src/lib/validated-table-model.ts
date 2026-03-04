import { documentDetailsByFileName } from '@/data/mock-data'
import {
  validatedDerivedDimensionsByDocId,
  validatedDerivedDimensionsByFileName,
} from '@/data/validated-derived-dimensions'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const monthAliases: Partial<Record<string, (typeof MONTHS)[number]>> = {
  jan: 'January',
  january: 'January',
  feb: 'February',
  february: 'February',
  mar: 'March',
  march: 'March',
  apr: 'April',
  april: 'April',
  may: 'May',
  jun: 'June',
  june: 'June',
  jul: 'July',
  july: 'July',
  aug: 'August',
  august: 'August',
  sep: 'September',
  sept: 'September',
  september: 'September',
  oct: 'October',
  october: 'October',
  nov: 'November',
  november: 'November',
  dec: 'December',
  december: 'December',
}

export type ParsedPeriod = {
  year: string
  month: string
  quarter: string
}

export type ValidatedTableRow = {
  docId: string
  fileName: string
  customerName: string
  atc: string
  taxBase: string
  taxBaseNumber: number
  taxWithheld: string
  taxWithheldNumber: number
  period: string
  confidence: string
  status: string
  year: string
  month: string
  quarter: string
  entity: string
  customerType: string
  errorTypes: Array<string>
}

type ValidatedDocumentInput = {
  id: string
  fileName: string
  payee: string
  period: string
  atc: string
  taxBase: string
  taxWithheld: string
  confidence: string
  status: string
}

const toQuarterFromMonth = (month: string): string => {
  const monthIndex = getMonthSortIndex(month)
  if (monthIndex < 0) return 'Unknown'
  return `Q${Math.floor(monthIndex / 3) + 1}`
}

const getQuarterEndMonth = (quarter: string): string => {
  switch (quarter.toUpperCase()) {
    case 'Q1':
      return 'March'
    case 'Q2':
      return 'June'
    case 'Q3':
      return 'September'
    case 'Q4':
      return 'December'
    default:
      return 'Unknown'
  }
}

const normalizeMonthName = (candidate: string): string => {
  const normalized = monthAliases[candidate.toLowerCase()]
  return normalized ?? 'Unknown'
}

export function getMonthSortIndex(month: string): number {
  return MONTHS.indexOf(month as (typeof MONTHS)[number])
}

export function parseAmount(value: string): number {
  const normalized = value.replace(/,/g, '').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parsePeriod(period: string): ParsedPeriod {
  const trimmed = period.trim()

  const quarterMatch = trimmed.match(/^Q([1-4])\s+(\d{4})$/i)
  if (quarterMatch) {
    const quarter = `Q${quarterMatch[1]}`
    const year = quarterMatch[2]
    return {
      year,
      quarter,
      month: getQuarterEndMonth(quarter),
    }
  }

  const monthMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (monthMatch) {
    const month = normalizeMonthName(monthMatch[1])
    const year = monthMatch[2]
    return {
      year,
      month,
      quarter: toQuarterFromMonth(month),
    }
  }

  return {
    year: 'Unknown',
    month: 'Unknown',
    quarter: 'Unknown',
  }
}

export function deriveMonthFromFileName(fileName: string): string {
  const match = fileName.match(/_(\d{2})(\d{2})(\d{4})_/)
  if (!match) return 'Unknown'

  const monthIndex = Number.parseInt(match[1], 10) - 1
  if (monthIndex < 0 || monthIndex > 11) return 'Unknown'

  return MONTHS[monthIndex]
}

const errorTypeRules: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /tin/i, label: 'Missing TIN' },
  { pattern: /signature/i, label: 'Missing Signature' },
  { pattern: /printed name/i, label: 'Missing Printed Name' },
  { pattern: /variance/i, label: 'Variance' },
  { pattern: /atc/i, label: 'ATC' },
]

export function classifyErrorType(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Other'

  const matchedRule = errorTypeRules.find((rule) => rule.pattern.test(trimmed))
  return matchedRule?.label ?? 'Other'
}

export function deriveErrorTypes(
  fileName: string,
  fallback?: Array<string>,
): Array<string> {
  if (fallback && fallback.length > 0) {
    return Array.from(new Set(fallback.map((item) => classifyErrorType(item))))
  }

  const details = documentDetailsByFileName[fileName]
  if (!details || details.errors.length === 0) {
    return ['None']
  }

  const values = details.errors.flatMap((error) => [
    classifyErrorType(error.message),
    classifyErrorType(error.code),
    classifyErrorType(error.stage),
  ])

  const deduped = Array.from(new Set(values.filter(Boolean)))
  return deduped.length > 0 ? deduped : ['None']
}

export function toValidatedTableRows(
  documents: Array<ValidatedDocumentInput>,
): Array<ValidatedTableRow> {
  return documents.map((document) => {
    const parsedPeriod = parsePeriod(document.period)
    const derivedMonth = deriveMonthFromFileName(document.fileName)
    const month = derivedMonth !== 'Unknown' ? derivedMonth : parsedPeriod.month
    const quarter =
      parsedPeriod.quarter !== 'Unknown'
        ? parsedPeriod.quarter
        : toQuarterFromMonth(month)

    const derived =
      validatedDerivedDimensionsByDocId[document.id] ??
      validatedDerivedDimensionsByFileName[document.fileName]

    return {
      docId: document.id,
      fileName: document.fileName,
      customerName: document.payee,
      atc: document.atc,
      taxBase: document.taxBase,
      taxBaseNumber: parseAmount(document.taxBase),
      taxWithheld: document.taxWithheld,
      taxWithheldNumber: parseAmount(document.taxWithheld),
      period: document.period,
      confidence: document.confidence,
      status: document.status,
      year: parsedPeriod.year,
      month,
      quarter,
      entity: derived?.entity ?? 'Unknown',
      customerType: derived?.customerType ?? 'Unknown',
      errorTypes: deriveErrorTypes(document.fileName, derived?.errorTypes),
    }
  })
}
