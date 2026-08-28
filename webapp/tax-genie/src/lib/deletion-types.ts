export const purgeStatuses = [
  'scheduled',
  'queued',
  'running',
  'failed',
  'blocked',
] as const

export type PurgeStatus = (typeof purgeStatuses)[number]

export type PurgeStatusView = {
  purgeStatus?: PurgeStatus | null
  purgeRequestedAt?: string | null
  purgeRequestedByUserId?: string | null
  purgeStartedAt?: string | null
  purgeError?: string | null
}

export type DeletionEligibilityCode =
  | 'eligible'
  | 'batch_deleted'
  | 'batch_not_deleted'
  | 'processing'
  | 'signed'
  | 'merged'
  | 'purge_in_progress'

export type DeletionEligibility = {
  canDelete: boolean
  code: DeletionEligibilityCode
  reason: string
}

export const eligibleForDeletion = (): DeletionEligibility => ({
  canDelete: true,
  code: 'eligible',
  reason: '',
})
