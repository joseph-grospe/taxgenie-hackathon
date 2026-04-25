import { createHash } from "node:crypto";
import type { WorkflowPageState } from "../types";
import {
  normalizePeriodCoveredValue,
  normalizePeriodEndValue,
} from "./parsing";

type JsonRecord = Record<string, unknown>;

export interface CurrentCertificatePageFingerprint {
  pageNumber: number;
  dataFingerprint: string;
}

export interface StoredPageFingerprint {
  pageNumber: number | null;
  dataFingerprint: string;
}

export interface StoredDuplicateMatchCandidate extends StoredPageFingerprint {
  existingFileName?: string | null;
  matchedVia: "certificate" | "upload";
}

export interface DuplicatePageMatch {
  currentPageNumber: number;
  existingPageNumber: number | null;
  existingFileName: string | null;
  matchedVia: "certificate" | "upload";
}

const DEDUPE_FIELDS = [
  "periodCovered",
  "periodEnd",
  "payeeName",
  "payeeTin",
  "payorName",
  "payorTin",
  "atcCode",
  "taxBase",
  "taxWithheld",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function sanitizeTinValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function parseBooleanishValue(raw: unknown): boolean | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }

  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw === "number") {
    return raw > 0;
  }

  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "y", "present", "exists", "signed"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "absent", "missing", "unsigned"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function parseMoneyValue(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Number(raw.toFixed(2));
  }

  if (typeof raw === "string") {
    const normalized = raw
      .trim()
      .replace(/[^\d.,\-]/g, "")
      .replace(/,(?=\d{3}(\D|$))/g, "");

    if (!normalized) {
      return undefined;
    }

    const decimal = Number(normalized.replace(/,/g, ""));
    return Number.isFinite(decimal) ? Number(decimal.toFixed(2)) : undefined;
  }

  return undefined;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/gu, " ").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTin(value: unknown): string | null {
  const sanitized = sanitizeTinValue(value);
  return sanitized.length > 0 ? sanitized : null;
}

function normalizeAtcCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeMoney(value: unknown): string | null {
  const parsed = parseMoneyValue(value);
  return typeof parsed === "number" && Number.isFinite(parsed)
    ? parsed.toFixed(2)
    : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  const parsed = parseBooleanishValue(value);
  return typeof parsed === "boolean" ? parsed : null;
}

function normalizeFieldValue(key: (typeof DEDUPE_FIELDS)[number], value: unknown) {
  switch (key) {
    case "periodCovered":
      return normalizePeriodCoveredValue(value) ?? null;
    case "periodEnd":
      return normalizePeriodEndValue(value) ?? null;
    case "payeeTin":
    case "payorTin":
      return normalizeTin(value);
    case "atcCode":
      return normalizeAtcCode(value);
    case "taxBase":
    case "taxWithheld":
      return normalizeMoney(value);
    default:
      return normalizeText(value);
  }
}

export function buildNormalizedDataFingerprint(
  normalized: Record<string, unknown> | undefined,
): string | undefined {
  if (!normalized) {
    return undefined;
  }

  const canonical = Object.fromEntries(
    DEDUPE_FIELDS.map((key) => [key, normalizeFieldValue(key, normalized[key])]),
  );

  const hasValue = Object.values(canonical).some((value) => value !== null);
  if (!hasValue) {
    return undefined;
  }

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export function buildBatchDataFingerprint(
  fingerprints: string[],
): string | undefined {
  const normalizedFingerprints = Array.from(
    new Set(
      fingerprints
        .map((fingerprint) => normalizeText(fingerprint))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();

  if (normalizedFingerprints.length === 0) {
    return undefined;
  }

  return createHash("sha256")
    .update(JSON.stringify(normalizedFingerprints))
    .digest("hex");
}

export function collectCurrentCertificateDataFingerprints(
  pages: WorkflowPageState[],
): string[] {
  return Array.from(
    new Set(
      pages
        .filter((page) => page.classification === "certificate")
        .map((page) =>
          buildNormalizedDataFingerprint(
            isRecord(page.normalized) ? page.normalized : undefined,
          ),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function collectCurrentCertificatePageFingerprints(
  pages: WorkflowPageState[],
): CurrentCertificatePageFingerprint[] {
  return pages
    .filter((page) => page.classification === "certificate")
    .map((page) => ({
      pageNumber: page.pageNumber,
      dataFingerprint: buildNormalizedDataFingerprint(
        isRecord(page.normalized) ? page.normalized : undefined,
      ),
    }))
    .filter(
      (
        page,
      ): page is CurrentCertificatePageFingerprint =>
        typeof page.dataFingerprint === "string" && page.dataFingerprint.length > 0,
    );
}

export function extractStoredSourceHash(payload: Record<string, unknown>): string | undefined {
  const dedupe = toRecord(payload.dedupe);
  const dedupeHash = normalizeText(dedupe.sourceHash);
  if (dedupeHash) {
    return dedupeHash;
  }

  const source = toRecord(payload.source);
  return normalizeText(source.hash) ?? undefined;
}

export function collectStoredDataFingerprints(
  payload: Record<string, unknown>,
): string[] {
  const dedupe = toRecord(payload.dedupe);
  const directFingerprint = normalizeText(dedupe.dataFingerprint);
  const fingerprintList = Array.isArray(dedupe.dataFingerprints)
    ? dedupe.dataFingerprints
        .map((value) => normalizeText(value))
        .filter((value): value is string => Boolean(value))
    : [];

  const normalized = toRecord(payload.normalized);
  const pageFingerprints = Array.isArray(payload.pages)
    ? payload.pages
        .map((page) => buildNormalizedDataFingerprint(toRecord(toRecord(page).normalized)))
        .filter((value): value is string => Boolean(value))
    : [];

  const derivedFingerprint = buildNormalizedDataFingerprint(normalized);

  return Array.from(
    new Set(
      [
        directFingerprint ?? undefined,
        derivedFingerprint,
        ...fingerprintList,
        ...pageFingerprints,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

export function collectStoredPageFingerprints(
  payload: Record<string, unknown>,
): StoredPageFingerprint[] {
  if (!Array.isArray(payload.pages)) {
    return [];
  }

  const pageFingerprints = payload.pages
    .map((page) => {
      const pageRecord = toRecord(page);
      const dedupe = toRecord(pageRecord.dedupe);
      const directFingerprint = normalizeText(dedupe.dataFingerprint);
      const derivedFingerprint = buildNormalizedDataFingerprint(
        toRecord(pageRecord.normalized),
      );
      const dataFingerprint = directFingerprint ?? derivedFingerprint;

      if (!dataFingerprint) {
        return undefined;
      }

      return {
        pageNumber:
          typeof pageRecord.pageNumber === "number" &&
          Number.isFinite(pageRecord.pageNumber)
            ? pageRecord.pageNumber
            : null,
        dataFingerprint,
      };
    })
    .filter((value): value is StoredPageFingerprint => Boolean(value));

  const uniqueFingerprints = new Map<string, StoredPageFingerprint>();
  for (const pageFingerprint of pageFingerprints) {
    const key = `${pageFingerprint.pageNumber ?? "null"}:${pageFingerprint.dataFingerprint}`;
    if (!uniqueFingerprints.has(key)) {
      uniqueFingerprints.set(key, pageFingerprint);
    }
  }

  return Array.from(uniqueFingerprints.values());
}

export function matchCurrentPagesToStoredDuplicates(
  currentPages: CurrentCertificatePageFingerprint[],
  storedCandidates: StoredDuplicateMatchCandidate[],
): DuplicatePageMatch[] {
  const storedCandidateByFingerprint = new Map<string, StoredDuplicateMatchCandidate>();

  for (const candidate of storedCandidates) {
    if (!storedCandidateByFingerprint.has(candidate.dataFingerprint)) {
      storedCandidateByFingerprint.set(candidate.dataFingerprint, candidate);
    }
  }

  const matches = currentPages
    .map((page) => {
      const candidate = storedCandidateByFingerprint.get(page.dataFingerprint);
      if (!candidate) {
        return undefined;
      }

      return {
        currentPageNumber: page.pageNumber,
        existingPageNumber: candidate.pageNumber,
        existingFileName: candidate.existingFileName ?? null,
        matchedVia: candidate.matchedVia,
      };
    })
    .filter((value): value is DuplicatePageMatch => Boolean(value))
    .sort((left, right) => left.currentPageNumber - right.currentPageNumber);

  const uniqueMatches = new Map<string, DuplicatePageMatch>();
  for (const match of matches) {
    const key = [
      match.currentPageNumber,
      match.existingPageNumber ?? "null",
      match.existingFileName ?? "",
      match.matchedVia,
    ].join(":");

    if (!uniqueMatches.has(key)) {
      uniqueMatches.set(key, match);
    }
  }

  return Array.from(uniqueMatches.values());
}
