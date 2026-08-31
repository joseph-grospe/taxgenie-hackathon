const enabled = (value: string | boolean | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const developmentDefault = import.meta.env.MODE !== 'production'

export const productFeatures = {
  merge: enabled(
    import.meta.env.VITE_TAXGENIE_ENABLE_MERGE,
    developmentDefault,
  ),
  outboundEmail: enabled(
    import.meta.env.VITE_TAXGENIE_ENABLE_OUTBOUND_EMAIL,
    developmentDefault,
  ),
  purge: enabled(
    import.meta.env.VITE_TAXGENIE_ENABLE_PURGE,
    developmentDefault,
  ),
} as const
