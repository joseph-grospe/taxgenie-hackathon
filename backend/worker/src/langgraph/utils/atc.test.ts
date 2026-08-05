import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAtcCode } from "./atc.ts";

test("normalizes ATC formatting without enforcing a code shape", () => {
  assert.equal(normalizeAtcCode(" wc-160 "), "WC160");
  assert.equal(normalizeAtcCode("WC 1607"), "WC1607");
  assert.equal(normalizeAtcCode("wi / 640"), "WI640");
});

test("keeps genuinely missing ATC values missing", () => {
  for (const value of [null, "", "  ", "-", "N/A", "not provided"]) {
    assert.equal(normalizeAtcCode(value), undefined);
  }
});
