import assert from "node:assert/strict";
import test from "node:test";

import { resolveAutomaticReconciliationMatchInput } from "./reconciliationAutoMatch.ts";

test("resolveAutomaticReconciliationMatchInput uses TIN-resolved payor short name", () => {
  assert.deepEqual(
    resolveAutomaticReconciliationMatchInput({
      originalFileName: "BIR2307_OTHER_CLIENT_SETT1_0825_20250903.pdf",
      normalized: {
        periodEnd: "2025-08-31",
        taxBase: "1,000.25",
        taxWithheld: 20.5,
      },
      payorShortName: " ACME ",
    }),
    {
      issuerShortName: "ACME",
      billingMonthMMYY: "0825",
      taxBase: 1000.25,
      taxWithheld: 20.5,
    },
  );
});

test("resolveAutomaticReconciliationMatchInput skips filename issuer fallback", () => {
  assert.equal(
    resolveAutomaticReconciliationMatchInput({
      originalFileName: "BIR2307_ACME_CLIENT_SETT1_0825_20250903.pdf",
      normalized: {
        periodEnd: "2025-08-31",
        taxBase: 1000,
        taxWithheld: 20,
      },
      payorShortName: null,
    }),
    null,
  );
});
