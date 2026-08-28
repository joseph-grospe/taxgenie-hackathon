import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";

export function normalizeIdentityName(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value)
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => (token === "corporation" ? "corp" : token))
    .join("");
  return normalized.length > 0 ? normalized : null;
}

export function compactIdentityNameSql(column: AnyColumn): SQL<string> {
  return sql<string>`regexp_replace(replace(' ' || regexp_replace(replace(lower(coalesce(${column}, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g') || ' ', ' corporation ', ' corp '), '[^a-z0-9]', '', 'g')`;
}
