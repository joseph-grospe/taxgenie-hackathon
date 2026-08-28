import assert from "node:assert/strict";
import test from "node:test";

import {
  IDENTITY_FIELD_REREAD_RESPONSE_SCHEMA,
  buildIdentityFieldRereadPrompt,
  identityFieldRereadResultSchema,
} from "./identityFieldRereadContract.ts";

test("identity reread contract accepts a visible value and confidence", () => {
  assert.deepEqual(
    identityFieldRereadResultSchema.parse({
      schemaVersion: 2,
      value: "000-123-456-000",
      confidence: 0.97,
      visibility: "readable",
    }),
    {
      schemaVersion: 2,
      value: "000-123-456-000",
      confidence: 0.97,
      visibility: "readable",
    },
  );
});

test("identity reread contract requires every property", () => {
  assert.equal(
    identityFieldRereadResultSchema.safeParse({
      schemaVersion: 2,
      value: "PAYEE",
    }).success,
    false,
  );
  assert.deepEqual(IDENTITY_FIELD_REREAD_RESPONSE_SCHEMA.required, [
    "schemaVersion",
    "value",
    "confidence",
    "visibility",
  ]);
});

test("identity reread contract rejects confidence outside zero to one", () => {
  for (const confidence of [-0.01, 1.01]) {
    assert.equal(
      identityFieldRereadResultSchema.safeParse({
        schemaVersion: 2,
        value: "PAYEE",
        confidence,
        visibility: "readable",
      }).success,
      false,
    );
  }
});

test("identity reread contract requires zero confidence for null", () => {
  assert.deepEqual(
    identityFieldRereadResultSchema.parse({
      schemaVersion: 2,
      value: null,
      confidence: 0,
      visibility: "blank",
    }),
    { schemaVersion: 2, value: null, confidence: 0, visibility: "blank" },
  );
  assert.equal(
    identityFieldRereadResultSchema.safeParse({
      schemaVersion: 2,
      value: null,
      confidence: 0.2,
      visibility: "unreadable",
    }).success,
    false,
  );
});

test("identity reread contract distinguishes blank from unreadable", () => {
  for (const visibility of ["blank", "unreadable"] as const) {
    assert.equal(
      identityFieldRereadResultSchema.safeParse({
        schemaVersion: 2,
        value: null,
        confidence: 0,
        visibility,
      }).success,
      true,
    );
  }
  assert.equal(
    identityFieldRereadResultSchema.safeParse({
      schemaVersion: 2,
      value: null,
      confidence: 0,
      visibility: "readable",
    }).success,
    false,
  );
  assert.equal(
    identityFieldRereadResultSchema.safeParse({
      schemaVersion: 2,
      value: "PAYEE",
      confidence: 0.99,
      visibility: "blank",
    }).success,
    false,
  );
});

test("identity reread prompt excludes reference values and defines visual confidence", () => {
  const prompt = buildIdentityFieldRereadPrompt({
    party: "payor",
    field: "tin",
  });
  assert.match(prompt, /visibly printed/u);
  assert.match(prompt, /must not represent.*masterlist/u);
  assert.doesNotMatch(prompt, /005031663/u);
  assert.doesNotMatch(prompt, /expected (?:name|tin|value)/iu);
});
