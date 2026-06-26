import assert from "node:assert/strict";
import test from "node:test";

import {
  appendZoneOcrText,
  assessZoneOcrNeeds,
  BIR_2307_ZONES,
  getBir2307ZoneOcrCandidates,
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

test("zone cue detection triggers header period for incomplete item 1 rows", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    1 For the Period From 0 7 2 6 2 0 2
    Part I Payee Information Taxpayer Identification Number TIN 267-090-070
    Part II Payor Information Taxpayer Identification Number TIN 266-567-164
    Income Payments Subject to Expanded Withholding Tax ATC WC160 Total 100.00 Tax Withheld 2.00
    VICTOR F. RADA Finance Manager TIN 942-107-070 Signature over Printed Name of Payor
  `);

  assert.ok(result.triggeredZones.includes("header_period"));
});

test("zone cue detection triggers header period for implausible OCR date fragments", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    1 For the Period From 09 01 2 02 51 MM DD YYYY To 08 30 2051 MM DD YYYY
    Part I Payee Information Taxpayer Identification Number TIN 004-760-842-000
    Payee's Name EAST ASIA UTILITIES CORPORATION
    Part II Payor Information Taxpayer Identification Number TIN 000-620-935-000
    Payor's Name CAMARINES SUR I ELECTRIC COOPERATIVE, INC.
    Income Payments Subject to Expanded Withholding Tax ATC WC160
    Amount of income payments 117,237.73 Tax Withheld 2,344.75
    EDNA M. VALERIO General Manager TIN 917-887-081-000
    Signature over Printed Name of Payor Authorized Representative
  `);

  assert.ok(result.triggeredZones.includes("header_period"));
});

test("zone cue detection accepts complete spaced item 1 period rows", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    1 For the Period From 0 7 2 6 2 0 2 5 To 0 8 2 5 2 0 2 5
    Part I Payee Information Taxpayer Identification Number TIN 267-090-070
    Payee's Name THERMA MARINE, INC.
    Part II Payor Information Taxpayer Identification Number TIN 266-567-164
    Payor's Name THERMA LUZON, INC.
    Income Payments Subject to Expanded Withholding Tax ATC WC160
    Amount of income payments 289.93 Tax Withheld PHP 5.80
    VICTOR F. RADA Finance Manager TIN 942-107-070
    Signature over Printed Name of Payor Authorized Representative
  `);

  assert.ok(!result.triggeredZones.includes("header_period"));
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

test("zone cue detection ignores unrelated global title text for signature block", () => {
  const result = assess(`
    Republic of the Philippines
    Department of Finance
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    For the Period From 07/01/2023 To 09/30/2023
    Part I Payee Information Taxpayer Identification Number TIN 267-090-070
    Part II Payor Information Taxpayer Identification Number TIN 000-801-156
    PANGASINAN III ELECTRIC COOPERATIVE PANELCO III
    Income Payments Subject to Expanded Withholding Tax ATC WC160 84,332.00 Tax Withheld 1,686.64
    We declare under the penalties of perjury that this certificate is true and correct.
    Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent
    CONFORME:
  `);

  assert.ok(result.triggeredZones.includes("signature_block"));
});

test("zone cue detection skips signature block when local signer name is present", () => {
  const result = assess(`
    BIR Form No. 2307 Certificate of Creditable Tax Withheld at Source
    For the Period From 07/01/2023 To 09/30/2023
    Part I Payee Information Taxpayer Identification Number TIN 267-090-070
    Part II Payor Information Taxpayer Identification Number TIN 000-801-156
    Income Payments Subject to Expanded Withholding Tax ATC WC160 84,332.00 Tax Withheld 1,686.64
    We declare under the penalties of perjury that this certificate is true and correct.
    ENGR. ALLAN G. CASEM
    Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent
    CONFORME:
  `);

  assert.ok(!result.triggeredZones.includes("signature_block"));
});

test("signature block zone uses a tight payor signer crop", () => {
  const zone = BIR_2307_ZONES.find((item) => item.id === "signature_block");
  assert.ok(zone);

  assert.equal(zone.label, "Payor signature text");
  assert.ok(zone.relativeRect.top >= 0.86);
  assert.ok(zone.relativeRect.width <= 0.55);
  assert.ok(zone.relativeRect.height <= 0.11);
});

test("signature block zone has bounded alternate OCR crop candidates", () => {
  const zone = BIR_2307_ZONES.find((item) => item.id === "signature_block");
  assert.ok(zone);

  const candidates = getBir2307ZoneOcrCandidates(zone);

  assert.equal(candidates.length, 3);
  assert.equal(
    candidates.every((candidate) => candidate.id === zone.id),
    true,
  );
  assert.equal(candidates[0]?.candidateId, "payor_left_lower");
  assert.equal(candidates[0]?.candidateSource, "fixed");
  assert.deepEqual(candidates[0]?.relativeRect, zone.relativeRect);
  assert.ok(candidates.every((candidate) => candidate.relativeRect.top >= 0.8));
  assert.ok(
    candidates.every((candidate) => candidate.relativeRect.height <= 0.12),
  );
});

test("signature block zone uses visual-anchor OCR candidates when a visual signature is detected", () => {
  const zone = BIR_2307_ZONES.find((item) => item.id === "signature_block");
  assert.ok(zone);

  const candidates = getBir2307ZoneOcrCandidates(zone, {
    signatureVisualDetection: {
      status: "detected",
      signaturePresent: true,
      confidence: 0.78,
      metrics: {
        darkPixelCount: 42634,
        candidateCount: 1,
        largestCandidateArea: 553,
        largestCandidateWidth: 42,
        largestCandidateHeight: 63,
        analysisWidth: 1904,
        analysisHeight: 188,
      },
      render: {
        dpi: 300,
        elapsedMs: 197,
        cropPixels: { x: 298, y: 2353, width: 1904, height: 521 },
        pagePixels: { width: 2481, height: 3509 },
      },
    },
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0]?.candidateId, "visual_anchor_payor_region");
  assert.equal(candidates[0]?.candidateSource, "visual_anchor");
  assert.equal(candidates[1]?.candidateId, "visual_anchor_payor_upper_band");
  assert.equal(candidates[1]?.candidateSource, "visual_anchor");
  assert.equal(candidates[2]?.candidateId, "payor_left_upper");
  assert.equal(candidates[2]?.candidateSource, "fixed");
  assert.ok((candidates[0]?.relativeRect.top ?? 1) < 0.7);
  assert.ok(
    (candidates[0]?.relativeRect.top ?? 0) +
      (candidates[0]?.relativeRect.height ?? 0) <
      0.84,
  );
});

test("signature block zone uses visual-anchor OCR when payor signer band is structurally visible", () => {
  const zone = BIR_2307_ZONES.find((item) => item.id === "signature_block");
  assert.ok(zone);

  const candidates = getBir2307ZoneOcrCandidates(zone, {
    signatureVisualDetection: {
      status: "not_detected",
      signaturePresent: false,
      confidence: 0,
      anchorOcrEligible: true,
      anchorOcrReason: "payor_signer_band_visible",
      structure: {
        payorSignerBandVisible: true,
        structuredWindowCount: 1,
        analysisWindowCount: 1,
      },
      metrics: {
        darkPixelCount: 24918,
        candidateCount: 0,
        largestCandidateArea: 0,
        largestCandidateWidth: 0,
        largestCandidateHeight: 0,
        analysisWidth: 1904,
        analysisHeight: 181,
      },
      render: {
        dpi: 300,
        elapsedMs: 237,
        cropPixels: { x: 298, y: 2047, width: 1904, height: 949 },
        pagePixels: { width: 2481, height: 3509 },
      },
    },
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0]?.candidateId, "visual_anchor_payor_region");
  assert.equal(candidates[0]?.candidateSource, "visual_anchor");
  assert.equal(candidates[1]?.candidateId, "visual_anchor_payor_upper_band");
  assert.equal(candidates[1]?.candidateSource, "visual_anchor");
  assert.equal(candidates[2]?.candidateId, "payor_left_upper");
  assert.equal(candidates[2]?.candidateSource, "fixed");
  assert.ok((candidates[0]?.relativeRect.top ?? 1) < 0.6);
  assert.ok(
    (candidates[0]?.relativeRect.top ?? 0) +
      (candidates[0]?.relativeRect.height ?? 0) >
      0.8,
  );
});

test("signature block zone keeps fixed candidates when no visual anchor or signer band exists", () => {
  const zone = BIR_2307_ZONES.find((item) => item.id === "signature_block");
  assert.ok(zone);

  const candidates = getBir2307ZoneOcrCandidates(zone, {
    signatureVisualDetection: {
      status: "not_detected",
      signaturePresent: false,
      confidence: 0,
      anchorOcrEligible: false,
      structure: {
        payorSignerBandVisible: false,
        structuredWindowCount: 0,
        analysisWindowCount: 2,
      },
      metrics: {
        darkPixelCount: 1200,
        candidateCount: 0,
        largestCandidateArea: 0,
        largestCandidateWidth: 0,
        largestCandidateHeight: 0,
        analysisWidth: 400,
        analysisHeight: 80,
      },
      render: {
        dpi: 300,
        elapsedMs: 5,
        cropPixels: { x: 0, y: 0, width: 400, height: 120 },
        pagePixels: { width: 800, height: 1000 },
      },
    },
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0]?.candidateId, "payor_left_lower");
  assert.equal(candidates[0]?.candidateSource, "fixed");
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
  assert.ok(
    enriched.parsedText?.includes("[Zone OCR fallback: signature_block]"),
  );
});

test("appendZoneOcrText discards low-signal signature crop OCR", () => {
  const enriched = appendZoneOcrText(
    {
      provider: "test",
      startedAt: "2026-05-06T00:00:00.000Z",
      finishedAt: "2026-05-06T00:00:01.000Z",
      durationMs: 1,
      raw: { text: "BIR Form No. 2307" },
      parsedText: "BIR Form No. 2307",
      metadata: {},
    },
    [
      {
        zoneId: "signature_block",
        text: "fsc 8000 division of general planning 2307 certificate 2.00 3.00 4.00 5.00 note the bpr data privacy website",
        markdown:
          "| 2307 | Certificate of Creditable Tax Withheld at Source |\n| 1. Tax due date | 2.00 3.00 4.00 5.00 |",
      },
    ],
  );

  assert.equal(enriched.parsedText, "BIR Form No. 2307");
  assert.equal(enriched.raw.zoneOcrFallbackText, undefined);
});

test("appendZoneOcrText keeps payor signer OCR evidence", () => {
  const enriched = appendZoneOcrText(
    {
      provider: "test",
      startedAt: "2026-05-06T00:00:00.000Z",
      finishedAt: "2026-05-06T00:00:01.000Z",
      durationMs: 1,
      raw: { text: "BIR Form No. 2307" },
      parsedText: "BIR Form No. 2307",
      metadata: {},
    },
    [
      {
        zoneId: "signature_block",
        text: "LEON D. SARALDE Finance Manager (901-327-847-000)\nSignature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
      },
    ],
  );

  assert.ok(
    enriched.parsedText?.includes("[Zone OCR fallback: signature_block]"),
  );
  assert.equal((enriched.raw.zoneOcrFallbackText as Array<unknown>).length, 1);
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

  const mainTextIndex =
    enriched.parsedText?.indexOf("THERMA MARINE, INC.") ?? -1;
  const fallbackIndex =
    enriched.parsedText?.indexOf("[Zone OCR fallback: signature_block]") ?? -1;

  assert.ok(mainTextIndex >= 0);
  assert.ok(fallbackIndex > mainTextIndex);
  assert.equal((enriched.raw.zoneOcrFallbackText as Array<unknown>).length, 1);
});
