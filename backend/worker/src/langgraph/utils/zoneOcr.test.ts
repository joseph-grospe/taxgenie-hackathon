import assert from "node:assert/strict";
import test from "node:test";

import {
  appendZoneOcrText,
  assessZoneOcrNeeds,
  BIR_2307_ZONES,
} from "./zoneOcr.ts";
import type { ExtractionPayload } from "../types.ts";

const payeeTinMissedRegressionPayload = {
  payeeTinRowApproxTop: 0.14,
  payeePayorSectionApproxBottom: 0.46,
  ocr: {
    main: {
      text: `
        | 1 For the Period | From | 01 41 01 | 21 01 26 | To | 01 41 31 | 21 01 26 |
        | Part I - Payee Information |
        | 2 Taxpayer Identification Number (TIN) | | 01 01 5 | 01 31 1 | 61 61 3 | 01 01 01 |
        | 3 Payee's Name |
        | Therma Visayas, Inc. (TVI) |
        | 4 Registered Address | 4A ZIP Code |
        | Bgry. Bato, Toledo City Cebu |
        | Part II - Payor Information |
        | 6 Taxpayer Identification Number (TIN) | | 01 01 0 | 51 61 9 | 01 71 2 | 01 01 01 |
      `,
    },
    zoneFallback: {
      blocks: [
        {
          zoneId: "payee_payor_info",
          content: `
            | 3 Payee's Name |
            | Therma Visayas, Inc. (TVI) |
            | 4 Registered Address | 4A ZIP Code |
            | Bgry. Bato, Toledo City Cebu |
            Part II - Payor Information
            | 6 Taxpayer Identification Number (TIN) | 010 0 | - | 516 9 | - | 017 2 | - | 010 10 |
          `,
        },
      ],
    },
  },
} as const;

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

test("payee/payor zone includes item 2 TIN row from missed-payee-TIN regression payload", () => {
  const zone = BIR_2307_ZONES.find((item) => item.id === "payee_payor_info");
  assert.ok(zone);

  assert.match(
    payeeTinMissedRegressionPayload.ocr.main.text,
    /2 Taxpayer Identification Number \(TIN\)/u,
  );
  assert.doesNotMatch(
    payeeTinMissedRegressionPayload.ocr.zoneFallback.blocks[0].content,
    /2 Taxpayer Identification Number \(TIN\)/u,
  );
  assert.ok(
    zone.relativeRect.top <=
      payeeTinMissedRegressionPayload.payeeTinRowApproxTop,
  );
  assert.ok(
    zone.relativeRect.top + zone.relativeRect.height >=
      payeeTinMissedRegressionPayload.payeePayorSectionApproxBottom,
  );
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

test("appendZoneOcrText preserves structured main OCR values before fallback text", () => {
  const enriched = appendZoneOcrText(
    {
      provider: "test",
      startedAt: "2026-05-06T00:00:00.000Z",
      finishedAt: "2026-05-06T00:00:01.000Z",
      durationMs: 1,
      raw: {
        data: {
          payeeInformation: {
            TIN: { value: "267-090-070-00000", type: "string" },
            name: { value: "THERMA MARINE, INC.", type: "string" },
          },
          payorInformation: {
            TIN: { value: "008-657-558-0000", type: "string" },
            name: { value: "ANGAT HYDROPOWER CORPORATION", type: "string" },
          },
          incomePayments: [
            {
              ATC: { value: "WC 160", type: "string" },
              taxWithheld: { value: 0.02, type: "number" },
            },
          ],
        },
      },
      metadata: {},
    },
    [
      {
        zoneId: "signature_block",
        text: "PABLITO A. PAMANTANG, JR. FINANCE MANAGER",
      },
    ],
  );

  const mainTextIndex = enriched.parsedText?.indexOf("THERMA MARINE, INC.") ?? -1;
  const fallbackIndex =
    enriched.parsedText?.indexOf("[Zone OCR fallback: signature_block]") ?? -1;

  assert.ok(mainTextIndex >= 0);
  assert.ok(fallbackIndex > mainTextIndex);
  assert.equal(
    (enriched.raw.zoneOcrFallbackText as Array<unknown>).length,
    1,
  );
});
