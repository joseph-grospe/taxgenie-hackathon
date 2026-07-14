import { createHash } from "node:crypto";
import type { WorkflowPageState } from "../types";
import { normalizeAtcCode as normalizeCanonicalAtcCode } from "./atc";
import {
  normalizePeriodCoveredValue,
  normalizePeriodEndValue,
} from "./parsing";

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
  return normalizeCanonicalAtcCode(value) ?? null;
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
