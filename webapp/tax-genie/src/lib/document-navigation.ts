const SIGNING_ROUTE_PATTERN =
  /^(?:\/documents\/[^/]+\/sign|\/upload\/batches\/[^/]+\/sign)\/?$/u

export const shouldUseHistoryBackForDocumentReferrer = (
  referrer: string,
  origin: string,
) => {
  if (!referrer) {
    return false
  }

  const referrerUrl = new URL(referrer, origin)

  if (referrerUrl.origin !== origin) {
    return false
  }

  if (SIGNING_ROUTE_PATTERN.test(referrerUrl.pathname)) {
    return false
  }

  return true
}
