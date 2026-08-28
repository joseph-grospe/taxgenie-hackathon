import type { ExtractedTaxRow } from "../services/extractionContract.ts";

export const SANITIZED_MERGED_ATC_TAX_ROWS = [
  {
    lineNumber: 1,
    pageNumber: 1,
    atcCode: "WC160",
    description: "Income payments made by top withholding agents",
    monthlyAmounts: {
      first: null,
      second: "117.81",
      third: null,
    },
    taxBase: "117.81",
    taxRate: null,
    taxWithheld: "2.36",
  },
  {
    lineNumber: 2,
    pageNumber: 1,
    atcCode: "WC160",
    description: "Income payments made by top withholding agents",
    monthlyAmounts: {
      first: null,
      second: "0.33",
      third: null,
    },
    taxBase: "0.33",
    taxRate: null,
    taxWithheld: "0.01",
  },
] satisfies ExtractedTaxRow[];

export const SANITIZED_MERGED_ATC_TOTALS = {
  taxBase: "118.14",
  taxWithheld: "2.37",
} as const;
