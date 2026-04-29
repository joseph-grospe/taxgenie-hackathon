import assert from "node:assert/strict";
import test from "node:test";

import { createValidateRulesNode } from "./validateRules.ts";
import type { WorkflowState } from "../types.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

test("validateRules ignores address and ZIP fields", async () => {
  const validateRules = createValidateRulesNode({
    atcRates: { WC160: 0.02 },
    varianceThresholdPhp: 1,
    logger: logger as never,
  });
  const state = {
    event: {
      sourceFileId: "source-1",
      revision: "v1",
    },
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        normalized: {
          periodCovered: "08-01-2025 to 08-31-2025",
          payeeName: "Payee A",
          payeeTin: "111-222-333-000",
          payeeAddress: "1 Main St.",
          payeeZip: "1226",
          payorName: "Payor A",
          payorTin: "444-555-666-000",
          payorAddress: "2 Main St.",
          payorZip: "8602",
          printedName: "Juan Dela Cruz",
          signaturePresent: true,
          atcCode: "WC160",
          taxBase: 100,
          taxWithheld: 2,
        },
      },
    ],
    batchSummary: {
      totalPages: 1,
      certificatePageNumbers: [1],
      ignoredPageNumbers: [],
      validPageNumbers: [],
      failedPageNumbers: [],
      duplicatePageNumbers: [],
    },
  } as WorkflowState;

  const result = await validateRules(state);

  assert.equal(result.validation?.status, "valid");
  assert.equal(result.decision?.route, "continue");
  assert.equal(
    result.validation?.checks.some((check) => /ADDRESS|ZIP/u.test(check.code)),
    false,
  );
});
