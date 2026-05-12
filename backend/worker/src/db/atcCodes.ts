import { asc } from "drizzle-orm";

import type { DbClient } from "./client";
import { atcCodes } from "./schema";

export async function loadAtcRates(
  db: DbClient,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      code: atcCodes.code,
      rate: atcCodes.rate,
    })
    .from(atcCodes)
    .orderBy(asc(atcCodes.code));

  const rates: Record<string, number> = {};
  for (const row of rows) {
    if (row.code && Number.isFinite(row.rate) && row.rate > 0) {
      rates[row.code] = row.rate;
    }
  }

  return rates;
}
