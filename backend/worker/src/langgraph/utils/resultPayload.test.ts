import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOcrEvidencePayload,
  buildPersistedPagePayload,
} from "./resultPayload.ts";

test("buildOcrEvidencePayload separates concise main and zone OCR evidence", () => {
  const payload = buildOcrEvidencePayload({
    provider: "mistral-ocr",
    startedAt: "2026-05-26T14:17:26.917Z",
    finishedAt: "2026-05-26T14:17:30.548Z",
    durationMs: 3631,
    parsedText:
      "Main OCR text\n\n[Zone OCR fallback: payee_payor_info]\nZone OCR text",
    raw: {
      model: "mistral-ocr-latest",
      pages: [
        {
          index: 0,
          markdown: "Main OCR text",
          images: [],
          tables: [null],
          dimensions: { width: 715, height: 1015 },
        },
      ],
      usage_info: {
        pages_processed: 1,
      },
      zoneOcrFallbackText: [
        {
          zoneId: "payee_payor_info",
          text: "Zone OCR text",
          markdown: "| Zone OCR markdown |",
        },
      ],
    },
    metadata: {
      zoneOcrFallback: {
        status: "completed",
        triggeredZones: ["payee_payor_info"],
        skippedZones: ["header_period"],
      },
    },
  });

  assert.equal(payload?.provider, "mistral-ocr");
  assert.equal(payload?.main.text, "Main OCR text");
  assert.deepEqual(payload?.main.pages, [
    {
      index: 0,
      dimensions: { width: 715, height: 1015 },
      imageCount: 0,
      tableCount: 1,
      markdown: "Main OCR text",
      markdownLength: 13,
    },
  ]);
  assert.deepEqual(payload?.zoneFallback.blocks, [
    {
      zoneId: "payee_payor_info",
      text: "Zone OCR text",
      markdown: "| Zone OCR markdown |",
    },
  ]);
  assert.equal(payload?.zoneFallback.status, "completed");
});

test("buildPersistedPagePayload omits duplicated raw extraction fields", () => {
  const payload = buildPersistedPagePayload({
    pageNumber: 1,
    classification: "certificate",
    extracted: { duplicated: true },
    extraction: {
      provider: "test",
      startedAt: "2026-05-26T00:00:00.000Z",
      finishedAt: "2026-05-26T00:00:01.000Z",
      durationMs: 1,
      parsedText: "Main OCR text",
      raw: { text: "Main OCR text" },
      metadata: {},
    },
    normalized: { payeeName: "THERMA MARINE, INC." },
  });

  assert.equal("extracted" in payload, false);
  assert.equal("extraction" in payload, false);
  assert.equal(payload.ocr?.main.text, "Main OCR text");
  assert.deepEqual(payload.normalized, { payeeName: "THERMA MARINE, INC." });
});
