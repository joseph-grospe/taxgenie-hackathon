import type { ReconciliationRowView } from '@/lib/reconciliation-types'

export type ReconciliationExportGranularity = 'monthly' | 'quarterly'

export type ReconciliationPeriodOption = {
  value: string
  label: string
}

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

export const formatQuarterLabel = (quarterKey: string) => {
  const match = quarterKey.match(/^(\d{4})-Q([1-4])$/)
  if (!match) {
    return quarterKey
  }

  return `Q${match[2]} ${match[1]}`
}

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

export const filterRowsForExportPeriod = (
  rows: Array<ReconciliationRowView>,
  granularity: ReconciliationExportGranularity,
  periodValue: string,
) =>
  rows.filter((row) =>
    granularity === 'monthly'
      ? row.derivedBillingMonthMMYY === periodValue
      : buildQuarterKey(row.derivedBillingMonthMMYY) === periodValue,
  )

