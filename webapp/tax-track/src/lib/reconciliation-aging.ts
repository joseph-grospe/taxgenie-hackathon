const MANILA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

export const RECONCILIATION_COLLECTION_GRACE_PERIOD_DAYS = 30

type ReconciliationDateValue = Date | string | number | null | undefined

const toValidDate = (value: ReconciliationDateValue) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

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

const toManilaBoundary = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day) - MANILA_UTC_OFFSET_MS)

const startOfManilaDay = (date: Date) => {
  const parts = getManilaParts(date)
  return toManilaBoundary(
    Number.parseInt(parts.year, 10),
    Number.parseInt(parts.month, 10) - 1,
    Number.parseInt(parts.day, 10),
  )
}

export const calculateDaysUncollected = (
  input: {
    emailSentAt: ReconciliationDateValue
    matchedAt?: ReconciliationDateValue
  },
  options: {
    now?: Date
    gracePeriodDays?: number
  } = {},
) => {
  const emailSentAt = toValidDate(input.emailSentAt)
  if (!emailSentAt) return null

  const endDate = toValidDate(input.matchedAt) ?? options.now ?? new Date()
  const gracePeriodDays =
    options.gracePeriodDays ?? RECONCILIATION_COLLECTION_GRACE_PERIOD_DAYS
  const graceDeadline = new Date(
    startOfManilaDay(emailSentAt).getTime() + gracePeriodDays * MS_PER_DAY,
  )
  const end = startOfManilaDay(endDate)

  return Math.max(
    0,
    Math.floor((end.getTime() - graceDeadline.getTime()) / MS_PER_DAY),
  )
}
