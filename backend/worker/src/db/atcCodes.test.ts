import assert from "node:assert/strict";
import test from "node:test";

import type { DbClient } from "./client.ts";
import { loadAtcRules } from "./atcCodes.ts";

test("loads normalized ATC rules with tax type and rate", async () => {
  const rows = [
    { code: " wc-157 ", taxType: " we ", rate: 0.02 },
    { code: "wv020", taxType: "wv", rate: 0.05 },
    { code: "INVALID", taxType: "WE", rate: 0 },
  ];
  const builder = {
    from: () => builder,
    orderBy: async () => rows,
  };
  const db = {
    select: () => builder,
  } as unknown as DbClient;

  assert.deepEqual(await loadAtcRules(db), {
    WC157: { code: "WC157", taxType: "WE", rate: 0.02 },
    WV020: { code: "WV020", taxType: "WV", rate: 0.05 },
  });
});
