import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPeriodCoveredValue,
  extractPeriodEndDate,
  extractPeriodStartDate,
  normalizePeriodCoveredValue,
  normalizePeriodEndValue,
  normalizePeriodStartValue,
} from "./parsing.ts";

test("extractPeriodEndDate parses compact month-day year values", () => {
  assert.equal(extractPeriodEndDate("0831 2025"), "2025-08-31");
});

test("extractPeriodEndDate returns the last date from a dashed range", () => {
  assert.equal(extractPeriodEndDate("08-01-2025 to 08-31-2025"), "2025-08-31");
});

test("extractPeriodStartDate returns the first date from a dashed range", () => {
  assert.equal(
    extractPeriodStartDate("08-01-2025 to 08-31-2025"),
    "2025-08-01",
  );
});

test("normalizePeriodStartValue formats dates as MM-DD-YYYY", () => {
  assert.equal(normalizePeriodStartValue("2025-08-01"), "08-01-2025");
});

test("normalizePeriodEndValue formats dates as MM-DD-YYYY", () => {
  assert.equal(normalizePeriodEndValue("2025-08-31"), "08-31-2025");
});

test("normalizePeriodCoveredValue formats ranges as MM-DD-YYYY to MM-DD-YYYY", () => {
  assert.equal(
    normalizePeriodCoveredValue("2025-08-01 to 2025-08-31"),
    "08-01-2025 to 08-31-2025",
  );
});

test("buildPeriodCoveredValue formats a range from separate date values", () => {
  assert.equal(
    buildPeriodCoveredValue("2025-08-01", "08-31-2025"),
    "08-01-2025 to 08-31-2025",
  );
});
