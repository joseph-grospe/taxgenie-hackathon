export function sanitizeCertificateNameToken(
  raw: unknown,
  fallback: string,
): string {
  const base = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  const safe = base
    .normalize("NFKD")
    .replace(/[^\w\-]+/gu, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");

  return safe || fallback;
}

export function sanitizeCertificateTin(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }

  return raw.replace(/\D/g, "");
}

function toIsoDate(
  year: number,
  month: number,
  day: number,
): string | undefined {
  if (![year, month, day].every(Number.isFinite)) {
    return undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function parseDateCandidate(raw: string): string | undefined {
  const clean = raw.replace(/[^\d/.\-\s]/gu, "").trim();
  if (!clean) {
    return undefined;
  }

  const compactMonthDayYear = clean.match(/^(\d{2})(\d{2})[\s/-]+(\d{4})$/u);
  if (compactMonthDayYear) {
    const [, monthPart, dayPart, yearPart] = compactMonthDayYear;
    return toIsoDate(Number(yearPart), Number(monthPart), Number(dayPart));
  }

  const parts = clean.split(/[/. -]/u).filter(Boolean);
  if (parts.length !== 3) {
    return undefined;
  }

  const [a, b, c] = parts;
  let year: number;
  let month: number;
  let day: number;

  if (a.length === 4) {
    year = Number(a);
    month = Number(b);
    day = Number(c);
  } else {
    month = Number(a);
    day = Number(b);
    year = Number(c.length === 2 ? `20${c}` : c);
  }

  return toIsoDate(year, month, day);
}

function extractCertificatePeriodDates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const candidateInputs = [
    trimmed,
    ...(trimmed.match(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/gu) ?? []),
    ...(trimmed.match(/\b\d{1,2}[./ -]\d{1,2}[./ -]\d{2,4}\b/gu) ?? []),
    ...(trimmed.match(/\b\d{4}[\s/-]+\d{4}\b/gu) ?? []),
  ];

  return Array.from(
    new Set(
      candidateInputs
        .map((candidate) => parseDateCandidate(candidate))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function extractCertificatePeriodEndDate(
  raw: unknown,
): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const candidates = extractCertificatePeriodDates(raw);
  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
}

export function formatCertificatePeriodKey(raw: unknown): string {
  const isoDate = extractCertificatePeriodEndDate(raw);
  if (!isoDate) {
    return "period-unknown";
  }

  const [year, month] = isoDate.split("-");
  return year && month ? `${year}-${month}` : "period-unknown";
}

export function formatCertificatePeriodToken(raw: unknown): string {
  const isoDate = extractCertificatePeriodEndDate(raw);
  if (!isoDate) {
    return "period_unknown";
  }

  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return "period_unknown";
  }

  return `${month}${day}${year}`;
}

export function buildUnsignedCertificateFileName(
  sourceFileId: string,
  normalized: Record<string, unknown>,
  processedNumber: number,
): string {
  const payee = sanitizeCertificateNameToken(
    normalized.payorName ?? normalized.companyName ?? sourceFileId,
    "PAYEE",
  );
  const tin = sanitizeCertificateTin(
    (normalized.payorTin ?? normalized.companyName ?? "000000000") as string,
  );
  const periodToken = formatCertificatePeriodToken(
    normalized.periodEnd ?? normalized.periodCovered,
  ).replace(/[\s/-]+/gu, "");
  const name = `${payee}_${tin || "TIN"}_${periodToken}_${processedNumber}`;
  return `${name}.pdf`;
}
