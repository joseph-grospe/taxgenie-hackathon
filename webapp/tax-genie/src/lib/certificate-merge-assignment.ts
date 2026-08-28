export type CertificateMergePackageType = 'quarterly' | 'annual'
export type CertificateMergeAssignmentStatus = 'assigned' | 'manual_review'

export type CertificateQuarterPeriod = {
  year: number
  quarter: 1 | 2 | 3 | 4
}

export type CertificateAnnualPeriod = {
  year: number
}

export type QuarterlyAssignmentDecision = {
  status: 'assigned'
  assignedYear: number
  assignedQuarter: 1 | 2 | 3 | 4
  isLate: boolean
  reason: string
}

export type AnnualAssignmentDecision =
  | {
      status: 'assigned'
      assignedYear: number
      assignedQuarter: null
      isLate: false
      reason: string
    }
  | {
      status: 'manual_review'
      assignedYear: null
      assignedQuarter: null
      isLate: boolean
      reason: string
    }

const toDateParts = (periodEnd: string | null | undefined) => {
  if (!periodEnd) return null

  const match = periodEnd.match(/^(\d{4})-(\d{2})-\d{2}/u)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  if (!Number.isInteger(year) || month < 1 || month > 12) return null

  return { year, month }
}

export const deriveCertificateQuarterPeriod = (
  periodEnd: string | null | undefined,
): CertificateQuarterPeriod | null => {
  const parts = toDateParts(periodEnd)
  if (!parts) return null

  return {
    year: parts.year,
    quarter: (Math.floor((parts.month - 1) / 3) + 1) as 1 | 2 | 3 | 4,
  }
}

export const deriveCertificateAnnualPeriod = (
  periodEnd: string | null | undefined,
): CertificateAnnualPeriod | null => {
  const parts = toDateParts(periodEnd)
  return parts ? { year: parts.year } : null
}

export const toQuarterPeriodKey = (period: CertificateQuarterPeriod) =>
  `${period.year}:Q${period.quarter}`

export const toAnnualPeriodKey = (period: CertificateAnnualPeriod) =>
  `${period.year}:TY`

export const formatAssignmentPeriodLabel = (input: {
  packageType: CertificateMergePackageType
  year: number | null
  quarter: number | null
}) => {
  if (input.year === null) return 'Manual review'
  return input.packageType === 'annual'
    ? `TY ${input.year}`
    : `Q${input.quarter ?? '-'} ${input.year}`
}

const nextQuarterPeriod = (
  period: CertificateQuarterPeriod,
): CertificateQuarterPeriod =>
  period.quarter === 4
    ? { year: period.year + 1, quarter: 1 }
    : {
        year: period.year,
        quarter: (period.quarter + 1) as 1 | 2 | 3 | 4,
      }

export const resolveQuarterlyAssignment = (
  source: CertificateQuarterPeriod,
  unavailablePeriodKeys: Set<string>,
  finalizedPeriodKeys: Set<string>,
): QuarterlyAssignmentDecision => {
  const sourceKey = toQuarterPeriodKey(source)
  let assigned = source

  while (unavailablePeriodKeys.has(toQuarterPeriodKey(assigned))) {
    assigned = nextQuarterPeriod(assigned)
  }

  const isNaturalPeriod = toQuarterPeriodKey(assigned) === sourceKey
  const isLate = finalizedPeriodKeys.has(sourceKey)

  return {
    status: 'assigned',
    assignedYear: assigned.year,
    assignedQuarter: assigned.quarter,
    isLate,
    reason: isNaturalPeriod
      ? 'natural_period'
      : isLate
        ? 'late_after_finalized_quarter'
        : 'quarterly_package_unavailable',
  }
}

export const resolveAnnualAssignment = (
  source: CertificateAnnualPeriod,
  unavailablePeriodKeys: Set<string>,
  finalizedPeriodKeys: Set<string>,
): AnnualAssignmentDecision => {
  const sourceKey = toAnnualPeriodKey(source)
  if (!unavailablePeriodKeys.has(sourceKey)) {
    return {
      status: 'assigned',
      assignedYear: source.year,
      assignedQuarter: null,
      isLate: false,
      reason: 'natural_period',
    }
  }

  const isLate = finalizedPeriodKeys.has(sourceKey)
  return {
    status: 'manual_review',
    assignedYear: null,
    assignedQuarter: null,
    isLate,
    reason: isLate
      ? 'late_after_finalized_annual'
      : 'annual_package_unavailable',
  }
}
