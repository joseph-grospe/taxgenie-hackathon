import assert from "node:assert/strict";
import test from "node:test";
import { buildNormalizedDataFingerprint } from "./dedupe.ts";

test("buildNormalizedDataFingerprint normalizes equivalent certificate data", () => {
  const left = buildNormalizedDataFingerprint({
    periodCovered: "08-01-2025 to 08-31-2025",
    periodEnd: "08-31-2025",
    payeeName: "EAST ASIA UTILITIES CORPORATION",
    payeeTin: "004-760-842-000",
    payorName: "1590 ENERGY CORP",
    payorTin: "007-833-205-000",
    atcCode: "WC160",
    taxBase: "10,201.33",
    taxWithheld: "204.03",
    signaturePresent: true,
  });
  const right = buildNormalizedDataFingerprint({
    periodCovered: "2025-08-01 to 2025-08-31",
    periodEnd: "0831 2025",
    payeeName: " east asia utilities corporation ",
    payeeTin: "004760842000",
    payorName: "1590 energy corp",
    payorTin: "007833205000",
    atcCode: "wc-160",
    taxBase: 10201.33,
    taxWithheld: "204.030",
    signaturePresent: "true",
  });

  assert.ok(left);
  assert.equal(left, right);
});
