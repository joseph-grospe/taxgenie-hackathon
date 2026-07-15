const ATC_CODE_PATTERN = /\b([A-Z]{2})\s*-?\s*(\d{3})\b/iu;

export function normalizeAtcCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.trim().toUpperCase().match(ATC_CODE_PATTERN);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return `${match[1]}${match[2]}`;
}
