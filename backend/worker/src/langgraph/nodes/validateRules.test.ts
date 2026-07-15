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

function buildState(atcCode = "WC160"): WorkflowState {
  return {
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
          atcCode,
          taxBase: 100,
          taxWithheld: atcCode === "WC051" ? 15 : atcCode === "WC630" ? 5 : 2,
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
}

test("validateRules ignores address and ZIP fields", async () => {
  const validateRules = createValidateRulesNode({
    getAtcRates: async () => ({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger: logger as never,
  });

  const result = await validateRules(buildState());

  assert.equal(result.validation?.status, "valid");
  assert.equal(result.decision?.route, "continue");
  assert.equal(
    result.validation?.checks.some((check) => /ADDRESS|ZIP/u.test(check.code)),
    false,
  );
});

test("validateRules uses rates loaded for each validation", async () => {
  let rates: Record<string, number> = {};
  let loadCount = 0;
  const validateRules = createValidateRulesNode({
    getAtcRates: async () => {
      loadCount += 1;
      return rates;
    },
    varianceThresholdPhp: 1,
    logger: logger as never,
  });

  const missingResult = await validateRules(buildState("WC630"));
  assert.equal(missingResult.validation?.status, "invalid");
  assert.equal(
    missingResult.pages?.[0]?.validation?.checks.some(
      (check) => check.code === "ATC_RATE_NOT_FOUND" && !check.passed,
    ),
    true,
  );

  rates = { WC630: 0.05 };
  const importedResult = await validateRules(buildState("WC630"));

  assert.equal(loadCount, 2);
  assert.equal(importedResult.validation?.status, "valid");
  assert.equal(importedResult.validation?.atcRate, 0.05);
});

test("validateRules canonicalizes ATC codes before rate lookup", async () => {
  const validateRules = createValidateRulesNode({
    getAtcRates: async () => ({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger: logger as never,
  });

  const result = await validateRules(buildState("WC 160 2%"));

  assert.equal(result.validation?.status, "valid");
  assert.equal(result.validation?.atcCode, "WC160");
  assert.equal(result.validation?.atcRate, 0.02);
});

test("validateRules records unknown ATC failures and continues validation", async () => {
  const validateRules = createValidateRulesNode({
    getAtcRates: async () => ({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger: logger as never,
  });

  const result = await validateRules(buildState("WC999"));

  assert.equal(result.validation?.status, "invalid");
  assert.equal(result.decision?.route, "continue");
  assert.deepEqual(result.decision?.reasonCodes, ["unknown_atc_code"]);
  assert.equal(
    result.validation?.checks.some(
      (check) => check.code === "ATC_RATE_NOT_FOUND" && !check.passed,
    ),
    true,
  );
  assert.equal(
    result.pages?.[0]?.validation?.checks.some(
      (check) => check.code === "ATC_RATE_NOT_FOUND" && !check.passed,
    ),
    true,
  );
});

test("validateRules still requires printed name when signature is visually present", async () => {
  const validateRules = createValidateRulesNode({
    getAtcRates: async () => ({ WC160: 0.02 }),
    varianceThresholdPhp: 1,
    logger: logger as never,
  });
  const state = buildState();
  state.pages![0]!.normalized!.printedName = undefined;
  state.pages![0]!.normalized!.signaturePresent = true;

  const result = await validateRules(state);

  assert.equal(result.validation?.status, "invalid");
  assert.deepEqual(result.decision?.reasonCodes, ["missing_printed_name"]);
  assert.equal(
    result.validation?.checks.some(
      (check) => check.code === "PRINTED_NAME_MISSING" && !check.passed,
    ),
    true,
  );
  assert.equal(
    result.validation?.checks.some(
      (check) => check.code === "SIGNATURE_PRESENT" && check.passed,
    ),
    true,
  );
});
