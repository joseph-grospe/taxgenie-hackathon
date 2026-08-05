import { asc, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { entities, masterlist } from "../../db/schema";
import { extractPeriodEndDate } from "./parsing";

export interface DocumentResultNormalizedColumns {
  periodEnd: string | null;
  payeeName: string | null;
  payeeTin: string | null;
  payeeShortName: string | null;
  payorName: string | null;
  payorTin: string | null;
  payorShortName: string | null;
}

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTinValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).replace(/\D/gu, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeShortName(value: unknown): string | null {
  return normalizeTextValue(value);
}

function getTinPrefix9(value: unknown): string | null {
  const normalized = normalizeTinValue(value);
  return normalized && normalized.length >= 9 ? normalized.slice(0, 9) : null;
}

export function buildDocumentResultNormalizedColumns(
  normalized: Record<string, unknown> | undefined,
  payeeShortName: string | null = null,
  payorShortName: string | null = null,
): DocumentResultNormalizedColumns {
  return {
    periodEnd:
      extractPeriodEndDate(
        normalized?.periodEnd ?? normalized?.periodCovered,
      ) ?? null,
    payeeName: normalizeTextValue(normalized?.payeeName),
    payeeTin: normalizeTinValue(normalized?.payeeTin),
    payeeShortName,
    payorName: normalizeTextValue(normalized?.payorName),
    payorTin: normalizeTinValue(normalized?.payorTin),
    payorShortName,
  };
}

async function resolveEntityShortName(
  db: DbClient,
  tin: unknown,
): Promise<string | null> {
  const tinPrefix = getTinPrefix9(tin);
  if (!tinPrefix) {
    return null;
  }

  const tinMatches = await db
    .select({
      shortName: entities.shortName,
    })
    .from(entities)
    .where(
      sql`regexp_replace(coalesce(${entities.tin}, ''), '[^0-9]', '', 'g') LIKE ${`${tinPrefix}%`}`,
    )
    .orderBy(asc(entities.id))
    .limit(1);

  return normalizeShortName(tinMatches[0]?.shortName);
}

export function resolvePayeeShortName(
  db: DbClient,
  normalized: Record<string, unknown> | undefined,
): Promise<string | null> {
  return resolveEntityShortName(db, normalized?.payeeTin);
}

export function resolvePayorShortName(
  db: DbClient,
  normalized: Record<string, unknown> | undefined,
): Promise<string | null> {
  return resolveMasterlistShortName(db, normalized?.payorTin);
}

async function resolveMasterlistShortName(
  db: DbClient,
  tin: unknown,
): Promise<string | null> {
  const tinPrefix = getTinPrefix9(tin);
  if (!tinPrefix) {
    return null;
  }

  const tinMatches = await db
    .select({
      shortName: masterlist.shortName,
    })
    .from(masterlist)
    .where(
      sql`regexp_replace(coalesce(${masterlist.tin}, ''), '[^0-9]', '', 'g') LIKE ${`${tinPrefix}%`}`,
    )
    .orderBy(asc(masterlist.shortName), asc(masterlist.customerName))
    .limit(1);

  return normalizeShortName(tinMatches[0]?.shortName);
}

export async function buildDocumentResultColumns(
  db: DbClient,
  normalized: Record<string, unknown> | undefined,
): Promise<DocumentResultNormalizedColumns> {
  const [payeeShortName, payorShortName] = await Promise.all([
    resolvePayeeShortName(db, normalized),
    resolvePayorShortName(db, normalized),
  ]);
  return buildDocumentResultNormalizedColumns(
    normalized,
    payeeShortName,
    payorShortName,
  );
}
