import type { ReconciliationRowView } from '@/lib/reconciliation-types'

export type ReconciliationExportGranularity = 'monthly' | 'quarterly' | 'annual'

export type ReconciliationPeriodOption = {
  value: string
  label: string
}

export const RECONCILIATION_EXPORT_YEAR_MIN = 2000
export const RECONCILIATION_EXPORT_YEAR_MAX = 2099
export const RECONCILIATION_EXPORT_YEAR_WINDOW = 5

const MONTH_NAMES = [
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

export const RECONCILIATION_EXPORT_MONTH_OPTIONS = MONTH_NAMES.map(
  (label, index) => ({
    value: String(index + 1),
    label,
  }),
)

export const RECONCILIATION_EXPORT_QUARTER_OPTIONS = [1, 2, 3, 4].map(
  (quarter) => ({
    value: String(quarter),
    label: `Q${quarter}`,
  }),
)

export const buildReconciliationExportYearOptions = (
  referenceYear = new Date().getFullYear(),
) => {
  const parsedYear = Number.isInteger(referenceYear)
    ? referenceYear
    : new Date().getFullYear()
  const startYear = Math.max(
    RECONCILIATION_EXPORT_YEAR_MIN,
    parsedYear - RECONCILIATION_EXPORT_YEAR_WINDOW,
  )
  const endYear = Math.min(
    RECONCILIATION_EXPORT_YEAR_MAX,
    parsedYear + RECONCILIATION_EXPORT_YEAR_WINDOW,
  )

  return Array.from({ length: endYear - startYear + 1 }, (_, index) => {
    const year = endYear - index
    return {
      value: String(year),
      label: String(year),
    }
  })
}

export const RECONCILIATION_EXPORT_YEAR_OPTIONS =
  buildReconciliationExportYearOptions()

const normalizeExportYear = (year: number | string) => {
  if (typeof year === 'string' && !/^\d{4}$/.test(year)) {
    return null
  }

  const parsedYear = typeof year === 'number' ? year : Number.parseInt(year, 10)

  if (
    !Number.isInteger(parsedYear) ||
    parsedYear < RECONCILIATION_EXPORT_YEAR_MIN ||
    parsedYear > RECONCILIATION_EXPORT_YEAR_MAX
  ) {
    return null
  }

  return parsedYear
}

export const isSupportedReconciliationExportYear = (year: number | string) =>
  normalizeExportYear(year) !== null

export const buildMonthlyReconciliationExportPeriod = (
  month: number | string,
  year: number | string,
) => {
  const parsedMonth =
    typeof month === 'number' ? month : Number.parseInt(month, 10)
  const parsedYear = normalizeExportYear(year)

  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    return null
  }

  if (parsedYear === null) {
    return null
  }

  return `${String(parsedMonth).padStart(2, '0')}${String(parsedYear).slice(-2)}`
}

export const buildQuarterlyReconciliationExportPeriod = (
  quarter: number | string,
  year: number | string,
) => {
  const parsedQuarter =
    typeof quarter === 'number' ? quarter : Number.parseInt(quarter, 10)
  const parsedYear = normalizeExportYear(year)

  if (
    !Number.isInteger(parsedQuarter) ||
    parsedQuarter < 1 ||
    parsedQuarter > 4
  ) {
    return null
  }

  if (parsedYear === null) {
    return null
  }

  return `${parsedYear}-Q${parsedQuarter}`
}

export const buildAnnualReconciliationExportPeriod = (
  year: number | string,
) => {
  const parsedYear = normalizeExportYear(year)

  return parsedYear === null ? null : String(parsedYear)
}

export const parseBillingMonthMMYY = (billingMonthMMYY: string) => {
  const match = billingMonthMMYY.match(/^(\d{2})(\d{2})$/)
  if (!match) {
    return null
  }

  const month = Number.parseInt(match[1], 10)
  const fullYear = Number.parseInt(`20${match[2]}`, 10)

  if (month < 1 || month > 12) {
    return null
  }

  return {
    month,
    fullYear,
  }
}

export const formatBillingPeriod = (billingMonthMMYY: string) => {
  const parsed = parseBillingMonthMMYY(billingMonthMMYY)
  if (!parsed) {
    return billingMonthMMYY
  }

  return `${MONTH_NAMES[parsed.month - 1]} ${parsed.fullYear}`
}

export const getQuarterFromBillingMonth = (billingMonthMMYY: string) => {
  const parsed = parseBillingMonthMMYY(billingMonthMMYY)
  if (!parsed) {
    return null
  }

  return {
    quarter: Math.ceil(parsed.month / 3),
    fullYear: parsed.fullYear,
  }
}

export const buildQuarterKey = (billingMonthMMYY: string) => {
  const quarter = getQuarterFromBillingMonth(billingMonthMMYY)
  if (!quarter) {
    return null
  }

  return `${quarter.fullYear}-Q${quarter.quarter}`
}

export const buildAnnualKey = (billingMonthMMYY: string) => {
  const parsed = parseBillingMonthMMYY(billingMonthMMYY)
  if (!parsed) {
    return null
  }

  return String(parsed.fullYear)
}

export const formatQuarterLabel = (quarterKey: string) => {
  const match = quarterKey.match(/^(\d{4})-Q([1-4])$/)
  if (!match) {
    return quarterKey
  }

  return `Q${match[2]} ${match[1]}`
}

export const formatAnnualLabel = (annualKey: string) => annualKey

export const compareBillingMonthDesc = (left: string, right: string) => {
  const leftParsed = parseBillingMonthMMYY(left)
  const rightParsed = parseBillingMonthMMYY(right)

  if (!leftParsed || !rightParsed) {
    return right.localeCompare(left)
  }

  return (
    rightParsed.fullYear * 100 +
    rightParsed.month -
    (leftParsed.fullYear * 100 + leftParsed.month)
  )
}

export const compareQuarterDesc = (left: string, right: string) => {
  const leftMatch = left.match(/^(\d{4})-Q([1-4])$/)
  const rightMatch = right.match(/^(\d{4})-Q([1-4])$/)

  if (!leftMatch || !rightMatch) {
    return right.localeCompare(left)
  }

  const leftValue =
    Number.parseInt(leftMatch[1], 10) * 10 + Number.parseInt(leftMatch[2], 10)
  const rightValue =
    Number.parseInt(rightMatch[1], 10) * 10 + Number.parseInt(rightMatch[2], 10)

  return rightValue - leftValue
}

export const compareAnnualDesc = (left: string, right: string) => {
  const leftYear = Number.parseInt(left, 10)
  const rightYear = Number.parseInt(right, 10)

  if (!Number.isFinite(leftYear) || !Number.isFinite(rightYear)) {
    return right.localeCompare(left)
  }

  return rightYear - leftYear
}

export const getMonthlyExportOptions = (
  rows: Array<ReconciliationRowView>,
): Array<ReconciliationPeriodOption> =>
  Array.from(
    new Set(rows.map((row) => row.derivedBillingMonthMMYY).filter(Boolean)),
  )
    .sort(compareBillingMonthDesc)
    .map((value) => ({
      value,
      label: formatBillingPeriod(value),
    }))

export const getQuarterlyExportOptions = (
  rows: Array<ReconciliationRowView>,
): Array<ReconciliationPeriodOption> =>
  Array.from(
    new Set(
      rows
        .map((row) => buildQuarterKey(row.derivedBillingMonthMMYY))
        .filter((value): value is string => Boolean(value)),
    ),
  )
    .sort(compareQuarterDesc)
    .map((value) => ({
      value,
      label: formatQuarterLabel(value),
    }))

export const getAnnualExportOptions = (
  rows: Array<ReconciliationRowView>,
): Array<ReconciliationPeriodOption> =>
  Array.from(
    new Set(
      rows
        .map((row) => buildAnnualKey(row.derivedBillingMonthMMYY))
        .filter((value): value is string => Boolean(value)),
    ),
  )
    .sort(compareAnnualDesc)
    .map((value) => ({
      value,
      label: formatAnnualLabel(value),
    }))

export const filterRowsForExportPeriod = (
  rows: Array<ReconciliationRowView>,
  granularity: ReconciliationExportGranularity,
  periodValue: string,
) =>
  rows.filter((row) => {
    if (granularity === 'monthly') {
      return row.derivedBillingMonthMMYY === periodValue
    }

    if (granularity === 'quarterly') {
      return buildQuarterKey(row.derivedBillingMonthMMYY) === periodValue
    }

    return buildAnnualKey(row.derivedBillingMonthMMYY) === periodValue
  })
