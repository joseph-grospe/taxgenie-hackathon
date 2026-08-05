import { asc } from "drizzle-orm";

import type { DbClient } from "./client";
import { atcCodes } from "./schema";

export interface AtcRule {
  code: string;
  taxType: string;
  rate: number;
}

export type AtcRuleMap = Record<string, AtcRule>;

const normalizeAtcCode = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");

const normalizeTaxType = (value: string): string =>
  value.trim().toUpperCase();

export async function loadAtcRules(db: DbClient): Promise<AtcRuleMap> {
  const rows = await db
    .select({
      code: atcCodes.code,
      taxType: atcCodes.taxType,
      rate: atcCodes.rate,
    })
    .from(atcCodes)
    .orderBy(asc(atcCodes.code));

  const rules: AtcRuleMap = {};
  for (const row of rows) {
    const code = normalizeAtcCode(row.code);
    const taxType = normalizeTaxType(row.taxType);
    if (code && taxType && Number.isFinite(row.rate) && row.rate > 0) {
      rules[code] = {
        code,
        taxType,
        rate: row.rate,
      };
    }
  }

  return rules;
}
