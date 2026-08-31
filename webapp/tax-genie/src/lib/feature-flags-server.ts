export type DeferredFeature = 'merge' | 'outbound_email' | 'purge'

const envByFeature: Record<DeferredFeature, string> = {
  merge: 'TAXGENIE_ENABLE_MERGE',
  outbound_email: 'TAXGENIE_ENABLE_OUTBOUND_EMAIL',
  purge: 'TAXGENIE_ENABLE_PURGE',
}

export const isFeatureEnabled = (feature: DeferredFeature) => {
  const value = process.env[envByFeature[feature]]?.trim().toLowerCase()
  if (!value) return process.env.NODE_ENV !== 'production'
  return ['1', 'true', 'yes', 'on'].includes(value)
}

export class FeatureDisabledError extends Error {
  readonly status = 503
  readonly code = 'feature_disabled'

  constructor(readonly feature: DeferredFeature) {
    super(`${feature} is disabled in this deployment.`)
    this.name = 'FeatureDisabledError'
  }
}

export const requireFeature = (feature: DeferredFeature) => {
  if (!isFeatureEnabled(feature)) {
    throw new FeatureDisabledError(feature)
  }
}

export const featureDisabledResponse = (_feature: DeferredFeature) =>
  new Response(JSON.stringify({ error: 'feature_disabled' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
