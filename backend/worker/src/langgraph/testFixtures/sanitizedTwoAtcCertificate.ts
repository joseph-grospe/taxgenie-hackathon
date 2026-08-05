import type { ExtractedTaxRow } from "../services/extractionContract.ts";

export const SANITIZED_TWO_ATC_TAX_ROWS = [
  {
    lineNumber: 1,
    pageNumber: 1,
    atcCode: "WC157",
    description: "Income payments to suppliers",
    monthlyAmounts: {
      first: null,
      second: "28030.86",
      third: null,
    },
    taxBase: "28030.86",
    taxRate: null,
    taxWithheld: "560.62",
  },
  {
    lineNumber: 2,
    pageNumber: 1,
    atcCode: "WV020",
    description: "Government money payments",
    monthlyAmounts: {
      first: null,
      second: "28030.86",
      third: null,
    },
    taxBase: "28030.86",
    taxRate: null,
    taxWithheld: "1401.54",
  },
] satisfies ExtractedTaxRow[];

export const SANITIZED_TWO_ATC_EXTRACTION_TOTALS = {
  taxBase: "56061.72",
  taxWithheld: "1962.16",
} as const;

export const SANITIZED_TWO_ATC_WE_TOTALS = {
  taxBase: "28030.86",
  taxWithheld: "560.62",
} as const;
