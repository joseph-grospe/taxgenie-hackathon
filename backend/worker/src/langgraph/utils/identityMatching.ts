import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";

export function normalizeIdentityName(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/gu, "");
  return normalized.length > 0 ? normalized : null;
}

export function compactIdentityNameSql(column: AnyColumn): SQL<string> {
  return sql<string>`regexp_replace(lower(coalesce(${column}, '')), '[^a-z0-9]', '', 'g')`;
}
