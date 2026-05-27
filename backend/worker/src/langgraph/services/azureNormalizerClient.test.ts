import assert from "node:assert/strict";
import test from "node:test";

import {
  AZURE_NORMALIZER_SYSTEM_PROMPT,
  buildNormalizerPromptPayload,
} from "./azureNormalizerClient.ts";

test("Azure normalizer prompt requires canonical TIN output", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /TIN fields/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /digits only/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Preserve leading zeroes/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /Do not infer, pad, truncate/u);
});

test("Azure normalizer prompt treats zone OCR as supplemental", () => {
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /ocr\.main/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /targeted high-resolution OCR/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /correct ocr\.main fields/u);
  assert.match(AZURE_NORMALIZER_SYSTEM_PROMPT, /very long repeated digit runs/u);
});

test("buildNormalizerPromptPayload separates main OCR and zone fallback evidence", () => {
  const payload = buildNormalizerPromptPayload({
    sourceFileId: "source-1",
    revision: "rev-1-page-1",
    selectedEntity: {
      id: 28,
      shortName: "TMI",
      companyName: "THERMA MARINE, INC.",
      tin: "26709007000000",
    },
    extraction: {
      provider: "mistral-ocr",
      startedAt: "2026-05-26T14:17:26.917Z",
      finishedAt: "2026-05-26T14:17:30.548Z",
      durationMs: 3631,
      parsedText:
        "main full page text\n\n[Zone OCR fallback: payee_payor_info]\nzone text",
      raw: {
        pages: [
          {
            markdown:
              "Part I - Payee Information TIN 2 6 7 8 9 0 1 0 7 0 1 0 6 6 6 6",
          },
        ],
        zoneOcrFallbackText: [
          {
            zoneId: "payee_payor_info",
            text: "TIN 2 6 7 0 9 0 0 7 0 0 0 0 0 0",
            markdown: "| TIN | 2 6 7 0 9 0 0 7 0 0 0 0 0 0 |",
          },
        ],
      },
      metadata: {
        zoneOcrFallback: {
          status: "completed",
          triggeredZones: ["payee_payor_info"],
        },
      },
    },
  });

  assert.equal(payload.payloadSchemaVersion, 2);
  assert.equal(payload.source.selectedEntity?.shortName, "TMI");
  assert.equal(payload.ocr.main.role, "main_full_page_ocr");
  assert.match(payload.ocr.main.text, /Payee Information/u);
  assert.doesNotMatch(payload.ocr.main.text, /Zone OCR fallback/u);
  assert.equal(payload.ocr.zoneFallback.status, "completed");
  assert.deepEqual(payload.ocr.zoneFallback.blocks, [
    {
      zoneId: "payee_payor_info",
      text: "TIN 2 6 7 0 9 0 0 7 0 0 0 0 0 0",
      markdown: "| TIN | 2 6 7 0 9 0 0 7 0 0 0 0 0 0 |",
    },
  ]);
});
