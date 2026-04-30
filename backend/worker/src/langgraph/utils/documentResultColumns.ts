import { asc, ilike, sql } from "drizzle-orm";
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

function normalizeNameForLookup(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeShortName(value: unknown): string | null {
  return normalizeTextValue(value);
}

export function buildDocumentResultNormalizedColumns(
  normalized: Record<string, unknown> | undefined,
  payeeShortName: string | null = null,
  payorShortName: string | null = null,
): DocumentResultNormalizedColumns {
  return {
    periodEnd: extractPeriodEndDate(
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
  name: unknown,
): Promise<string | null> {
  const normalizedTin = normalizeTinValue(tin);

  if (normalizedTin) {
    const tinMatches = await db
      .select({
        shortName: entities.shortName,
      })
      .from(entities)
      .where(
        sql`regexp_replace(coalesce(${entities.tin}, ''), '[^0-9]', '', 'g') = ${normalizedTin}`,
      )
      .orderBy(asc(entities.id))
      .limit(1);
    const shortName = normalizeShortName(tinMatches[0]?.shortName);

    if (shortName) {
      return shortName;
    }
  }

  const normalizedName = normalizeTextValue(name);
  if (!normalizedName) {
    return null;
  }

  const lookupName = normalizeNameForLookup(normalizedName);
  const nameMatches = await db
    .select({
      shortName: entities.shortName,
    })
    .from(entities)
    .where(
      sql`regexp_replace(lower(trim(coalesce(${entities.companyName}, ''))), '[[:space:]]+', ' ', 'g') = ${lookupName}`,
    )
    .orderBy(asc(entities.id))
    .limit(1);

  return normalizeShortName(nameMatches[0]?.shortName);
}

export function resolvePayeeShortName(
  db: DbClient,
  normalized: Record<string, unknown> | undefined,
): Promise<string | null> {
  return resolveEntityShortName(db, normalized?.payeeTin, normalized?.payeeName);
}

export function resolvePayorShortName(
  db: DbClient,
  normalized: Record<string, unknown> | undefined,
): Promise<string | null> {
  return resolveMasterlistShortName(
    db,
    normalized?.payorTin,
    normalized?.payorName,
  );
}

async function resolveMasterlistShortName(
  db: DbClient,
  tin: unknown,
  name: unknown,
): Promise<string | null> {
  const normalizedTin = normalizeTinValue(tin);
  const tinPrefix =
    normalizedTin && normalizedTin.length >= 9
      ? normalizedTin.slice(0, 9)
      : null;

  if (tinPrefix) {
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
    const shortName = normalizeShortName(tinMatches[0]?.shortName);

    if (shortName) {
      return shortName;
    }
  }

  const normalizedName = normalizeTextValue(name);
  if (!normalizedName) {
    return null;
  }

  const nameMatches = await db
    .select({
      shortName: masterlist.shortName,
    })
    .from(masterlist)
    .where(ilike(masterlist.customerName, `%${normalizedName}%`))
    .orderBy(asc(masterlist.shortName), asc(masterlist.customerName))
    .limit(1);

  return normalizeShortName(nameMatches[0]?.shortName);
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
