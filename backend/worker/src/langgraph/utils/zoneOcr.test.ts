import assert from "node:assert/strict";
import test from "node:test";

import { appendZoneOcrText, assessZoneOcrNeeds } from "./zoneOcr.ts";
import type { ExtractionPayload } from "../types.ts";

function extraction(text: string): ExtractionPayload {
  return {
    provider: "test",
    startedAt: "2026-05-06T00:00:00.000Z",
    finishedAt: "2026-05-06T00:00:01.000Z",
    durationMs: 1,
    raw: { text },
    parsedText: text,
    metadata: {},
  };
}

function assess(text: string) {
  return assessZoneOcrNeeds({
    extraction: extraction(text),
    likelyCertificate: true,
    isSinglePage: true,
    singlePageRescueEnabled: true,
    maxZones: 4,
  });
}

test("zone cue detection does not trigger fallback when all zone cues are present", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    For the Period From 01/01/2024 To 03/31/2024
    Part I Payee Information Taxpayer Identification Number TIN 267-090-070
    Payee's Name THERMA MARINE, INC.
    Part II Payor Information Taxpayer Identification Number TIN 266-567-164
    Payor's Name THERMA LUZON, INC.
    Income Payments Subject to Expanded Withholding Tax ATC WC160
    Amount of income payments 289.93 Tax Withheld PHP 5.80
    We declare under the penalties of perjury.
    VICTOR F. RADA Finance Manager TIN 942-107-070
    Signature over Printed Name of Payor Authorized Representative
  `);

  assert.deepEqual(result.triggeredZones, []);
});

test("zone cue detection triggers header period when period cues are missing", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    Part I Payee Information TIN 267-090-070 Part II Payor Information TIN 266-567-164
    ATC WC160 Tax Withheld PHP 5.80
    VICTOR F. RADA Finance Manager TIN 942-107-070 Signature over Printed Name
  `);

  assert.ok(result.triggeredZones.includes("header_period"));
});

test("zone cue detection triggers payee/payor when TIN cues are missing", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    For the Period From 01/01/2024 To 03/31/2024
    Payee Information Payor Information
    ATC WC160 Tax Withheld PHP 5.80
    VICTOR F. RADA Finance Manager TIN 942-107-070 Signature over Printed Name
  `);

  assert.ok(result.triggeredZones.includes("payee_payor_info"));
});

test("zone cue detection triggers tax table when ATC and amount cues are missing", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    For the Period From 01/01/2024 To 03/31/2024
    Part I Payee Information TIN 267-090-070 Part II Payor Information TIN 266-567-164
    VICTOR F. RADA Finance Manager TIN 942-107-070 Signature over Printed Name
  `);

  assert.ok(result.triggeredZones.includes("tax_table"));
});

test("zone cue detection triggers signature block when label exists without signatory content", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    For the Period From 01/01/2024 To 03/31/2024
    Part I Payee Information TIN 267-090-070 Part II Payor Information TIN 266-567-164
    ATC WC160 Tax Withheld PHP 5.80
    Signature over Printed Name of Payor Authorized Representative
  `);

  assert.ok(result.triggeredZones.includes("signature_block"));
});

test("appendZoneOcrText preserves original raw markdown when parsedText is missing", () => {
  const markdown = `
    Republic of the Philippines
    Department of Finance
    Bureau of Internal Revenue
    | BIR Form No.
    2307 | Certificate of Creditable Tax
    Withheld At Source |
  `;
  const enriched = appendZoneOcrText(
    {
      provider: "test",
      startedAt: "2026-05-06T00:00:00.000Z",
      finishedAt: "2026-05-06T00:00:01.000Z",
      durationMs: 1,
      raw: { pages: [{ markdown }] },
      metadata: {},
    },
    [
      {
        zoneId: "signature_block",
        text: "VICTOR F. RADA Finance Manager TIN 942-107-070",
      },
    ],
  );

  assert.ok(enriched.parsedText?.includes("BIR Form No."));
  assert.ok(enriched.parsedText?.includes("[Zone OCR fallback: signature_block]"));
});
