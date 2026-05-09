import assert from "node:assert/strict";
import test from "node:test";

import { AZURE_NORMALIZER_SYSTEM_PROMPT } from "./azureNormalizerClient.ts";

test("Azure normalizer prompt requires canonical TIN output", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /TIN fields/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /digits only/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Preserve leading zeroes/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Do not infer, pad, truncate/u);
});
