import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkerEnv } from "@taxgenie/shared";
import {
  DEFAULT_GEMINI_MODEL,
  resolveGeminiConfig,
} from "./geminiConfig.ts";

function loadTestEnv(model?: string) {
  return loadWorkerEnv({
    NODE_ENV: "test",
    GCP_REGION: "asia-southeast1",
    STORAGE_BUCKET_NAME: "test-bucket",
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: model,
    GEMINI_THINKING_LEVEL: "high",
    GEMINI_MEDIA_RESOLUTION: "medium",
  });
}

test("defaults to the pinned Gemini 3.5 Flash model", () => {
  const config = resolveGeminiConfig(loadTestEnv());

  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash");
  assert.equal(config.model, "gemini-3.5-flash");
});

test("accepts an explicitly configured pinned model", () => {
  const config = resolveGeminiConfig(loadTestEnv("gemini-3.5-flash"));

  assert.equal(config.model, "gemini-3.5-flash");
});

test("rejects the former Gemini 3 Flash preview model", () => {
  const formerPreviewModel = ["gemini-3-flash", "preview"].join("-");

  assert.throws(
    () => resolveGeminiConfig(loadTestEnv(formerPreviewModel)),
    /requires GEMINI_MODEL to be exactly "gemini-3\.5-flash"/,
  );
});
