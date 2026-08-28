const MISSING_ATC_CODE_PATTERN =
  /^(?:n\/?a|none|null|unknown|not\s+(?:available|applicable|provided)|blank|-+)$/iu;

export function normalizeAtcCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sourceValue = value.trim();
  if (!sourceValue || MISSING_ATC_CODE_PATTERN.test(sourceValue)) {
    return undefined;
  }

  const normalized = sourceValue.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  return normalized.length > 0 ? normalized : undefined;
}
