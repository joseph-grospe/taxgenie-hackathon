import type {
  DashboardPeriodType,
  DashboardTrendGroup,
} from '@/lib/dashboard-types'
import { isDashboardTrendGroup } from '@/lib/dashboard-types'

const MANILA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

type DashboardPeriodInput = {
  periodType?: unknown
  period?: unknown
  trendGroup?: unknown
}

export type DashboardPeriodSearch = {
  periodType: DashboardPeriodType
  period: string
  trendGroup: DashboardTrendGroup
}

const isDashboardPeriodType = (value: unknown): value is DashboardPeriodType =>
  value === 'monthly' || value === 'quarterly' || value === 'yearly'

const toManilaBoundary = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day) - MANILA_UTC_OFFSET_MS)

const getManilaParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const valueByType = new Map(parts.map((part) => [part.type, part.value]))

  return {
    year: valueByType.get('year') ?? '0000',
    month: valueByType.get('month') ?? '01',
    day: valueByType.get('day') ?? '01',
  }
}

export const getDefaultDashboardPeriod = (
  periodType: DashboardPeriodType = 'yearly',
  now = new Date(),
) => {
  const parts = getManilaParts(now)
  const year = Number.parseInt(parts.year, 10)

  if (periodType === 'monthly') {
    return `${year}-${parts.month}`
  }

  if (periodType === 'quarterly') {
    const month = Number.parseInt(parts.month, 10)
    return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  }

  return String(year)
}

export const getDefaultDashboardTrendGroup = (
  periodType: DashboardPeriodType = 'yearly',
): DashboardTrendGroup => (periodType === 'yearly' ? 'monthly' : 'daily')

export const isValidDashboardPeriod = (
  periodType: DashboardPeriodType,
  period: string,
) => {
  if (periodType === 'monthly') {
    const match = period.match(/^(\d{4})-(\d{2})$/u)
    if (!match) return false
    const month = Number.parseInt(match[2], 10)
    return month >= 1 && month <= 12
  }

  if (periodType === 'quarterly') {
    return /^\d{4}-Q[1-4]$/u.test(period)
  }

  return /^\d{4}$/u.test(period)
}

export const parseDashboardSearch = (
  input: DashboardPeriodInput,
): DashboardPeriodSearch => {
  const periodType = isDashboardPeriodType(input.periodType)
    ? input.periodType
    : 'yearly'
  const period =
    typeof input.period === 'string' && input.period.trim().length > 0
      ? input.period.trim()
      : getDefaultDashboardPeriod(periodType)

  return {
    periodType,
    period: isValidDashboardPeriod(periodType, period)
      ? period
      : getDefaultDashboardPeriod(periodType),
    trendGroup: isDashboardTrendGroup(input.trendGroup)
      ? input.trendGroup
      : getDefaultDashboardTrendGroup(periodType),
  }
}

export const getDashboardPeriodOptions = (
  periodType: DashboardPeriodType,
  selectedPeriod: string,
  now = new Date(),
) => {
  const currentYear = Number.parseInt(getManilaParts(now).year, 10)
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index)
  const options =
    periodType === 'yearly'
      ? years.map((year) => ({ value: String(year), label: String(year) }))
      : periodType === 'quarterly'
        ? years.flatMap((year) =>
            [4, 3, 2, 1].map((quarter) => ({
              value: `${year}-Q${quarter}`,
              label: `Q${quarter} ${year}`,
            })),
          )
        : years.flatMap((year) =>
            Array.from({ length: 12 }, (_, index) => {
              const month = 12 - index
              const value = `${year}-${String(month).padStart(2, '0')}`
              return {
                value,
                label: new Intl.DateTimeFormat('en-US', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'Asia/Manila',
                }).format(toManilaBoundary(year, month - 1, 1)),
              }
            }),
          )

  return options.some((option) => option.value === selectedPeriod)
    ? options
    : [{ value: selectedPeriod, label: selectedPeriod }, ...options]
}
