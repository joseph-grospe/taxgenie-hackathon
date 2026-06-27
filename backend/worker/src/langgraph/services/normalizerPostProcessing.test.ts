import assert from "node:assert/strict";
import test from "node:test";

import {
  BIR2307_DOCUMENT_ANNOTATION_FORMAT,
  BIR2307_DOCUMENT_ANNOTATION_PROMPT,
  getDocumentAnnotation,
  NORMALIZER_PROMPT_SCHEMA_VERSION,
  postProcessNormalizedFields,
} from "./normalizerPostProcessing.ts";
import type { ExtractionPayload } from "../types.ts";

function createTestExtraction(
  raw: Record<string, unknown> = {},
): ExtractionPayload {
  return {
    provider: "mistral-ocr",
    startedAt: "2026-05-26T14:17:26.917Z",
    finishedAt: "2026-05-26T14:17:30.548Z",
    durationMs: 3631,
    raw,
    metadata: {},
  };
}

function process(input: {
  normalized: Record<string, unknown>;
  extraction?: ExtractionPayload;
  annotationRaw?: Record<string, unknown>;
  signatureVisualDetection?: {
    status?: string;
    signaturePresent?: boolean;
    anchorOcrEligible?: boolean;
    structure?: { payorSignerBandVisible?: boolean };
  };
}) {
  return postProcessNormalizedFields({
    normalized: input.normalized,
    extraction: input.extraction ?? createTestExtraction(),
    annotationRaw: input.annotationRaw,
    signatureVisualDetection: input.signatureVisualDetection,
    audit: {
      sourceFileId: "source-1",
      revision: "rev-1-page-1",
      startedAt: "2026-06-25T00:00:00.000Z",
      elapsedMs: 1234,
      provider: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      responseModel: "mistral-ocr-latest",
      requestPayloadChars: 123,
      annotationPayloadChars: 456,
      usageInfo: { pages_processed: 1 },
    },
  });
}

test("document annotation parser accepts objects and JSON strings", () => {
  assert.deepEqual(
    getDocumentAnnotation({ document_annotation: { foo: "bar" } }),
    {
      foo: "bar",
    },
  );
  assert.deepEqual(
    getDocumentAnnotation({
      document_annotation: JSON.stringify({ payeeName: "THERMA MARINE, INC." }),
    }),
    { payeeName: "THERMA MARINE, INC." },
  );
});

test("document annotation prompt guides month of quarter total-row cases", () => {
  const monthDescription =
    BIR2307_DOCUMENT_ANNOTATION_FORMAT.json_schema.schema.properties
      .monthOfQuarter.description;

  assert.equal(NORMALIZER_PROMPT_SCHEMA_VERSION, 8);
  assert.match(monthDescription, /exactly one monthly column/iu);
  assert.match(monthDescription, /multiple non-zero monthly columns/iu);
  assert.match(monthDescription, /Return null/iu);

  assert.match(
    BIR2307_DOCUMENT_ANNOTATION_PROMPT,
    /Do not infer monthOfQuarter from periodEnd/iu,
  );
  assert.match(
    BIR2307_DOCUMENT_ANNOTATION_PROMPT,
    /0\.00, 216\.09, 0\.00 and total taxBase 216\.09, return second/iu,
  );
  assert.match(
    BIR2307_DOCUMENT_ANNOTATION_PROMPT,
    /51,675\.41, 93,120\.95, and 202,891\.10 with total taxBase 347,687\.46, return null/iu,
  );
  assert.match(
    BIR2307_DOCUMENT_ANNOTATION_PROMPT,
    /2\.13 in the 1st month and total taxBase 2\.13, return first/iu,
  );
});

test("post-processing derives month of quarter from tax base table placement", () => {
  const result = process({
    normalized: {
      periodStart: "01-01-2026",
      periodEnd: "03-31-2026",
      monthOfQuarter: null,
      atcCode: "WC160",
      taxBase: "9,131.50",
      taxWithheld: "182.63",
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
|  Income Payments Subject to Expanded Withholding Tax | ATC | AMOUNT OF INCOME PAYMENTS |   |   |   |   |   |   |   | Tax Withheld for the Quarter  |   |   |
|   |   |  1st Month of the Quarter | 2nd Month of the Quarter |   | 3rd Month of the Quarter |   | Total  |   |   |   |   |   |
|  INCOME PAYMENT MADE BY TOP |   | WC160 | 0.00 | 9,131.50 |   | 0.00 |   | 9,131.50 |   |   | 182.63  |   |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.taxBase, 9131.5);
  assert.equal(result.fields.monthOfQuarter, "second");
});

test("post-processing prefers clear table month over annotation month", () => {
  const result = process({
    normalized: {
      periodStart: "03-01-2026",
      periodEnd: "03-31-2026",
      monthOfQuarter: "first",
      atcCode: "WC160",
      taxBase: 120.05,
      taxWithheld: 2.4,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
|   |   |  1st Month of the Quarter | 2nd Month of the Quarter | 3rd Month of the Quarter | Total  |   |   |   |
|  Income payment made by top withholding agents to their local/resident supplier of services other than those covered by other | WC160 | 0.00 | 0.00 | 120.05 | 120.05 |   | 2.40  |   |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.monthOfQuarter, "third");
});

test("post-processing preserves blank month cells for spaced ATC codes", () => {
  const result = process({
    normalized: {
      periodStart: "04-01-2025",
      periodEnd: "06-30-2025",
      monthOfQuarter: null,
      atcCode: "WC 157",
      taxBase: 52541.16,
      taxWithheld: 1050.82,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
|   |   |  1st Month of the Quarter | 2nd Month of the Quarter | 3rd Month of the Quarter | Total  |   |   |   |   |   |   |
|  EBIT income payments made by the government to its local suppliers of services |   | WC 157 |  |  | 52,541.16 | 52,541.16 |   |   |   | 1,050.82  |   |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.monthOfQuarter, "third");
});

test("post-processing preserves paired blank month cells before third-month amounts", () => {
  const result = process({
    normalized: {
      periodStart: "07-01-2023",
      periodEnd: "09-30-2023",
      monthOfQuarter: "first",
      atcCode: "WC160",
      taxBase: 84332,
      taxWithheld: 1686.64,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
|  Income Payments Subject to Expanded Withholding Tax | ATC | AMOUNT OF INCOME PAYMENTS |   |   |   |   |   |   |   | Tax Withheld for the Quarter  |   |   |
|   |   |  1st Month of the Quarter |   | 2nd Month of the Quarter |   | 3rd Month of the Quarter |   | Total  |   |   |   |   |
|  Income payment made by top withholding age |   | WC160 |  |   |  |   | 84,332.00 |   | 84,332.00 |   | 1,686.64  |   |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.monthOfQuarter, "third");
});

test("post-processing derives second month from a breakdown total row", () => {
  const result = process({
    normalized: {
      periodStart: "01-01-2026",
      periodEnd: "03-31-2026",
      monthOfQuarter: "first",
      atcCode: "WC 160",
      taxBase: 216.09,
      taxWithheld: 4.33,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
| Income Payments Subject to Expanded Withholding Tax | ATC | 1st Month of the Quarter | 2nd Month of the Quarter | 3rd Month of the Quarter | Total | Tax Withheld for the Quarter |
| Income Payments made by top withholding agents | WC 160 | 0.00 | 187.35 | 0.00 | 187.35 | 3.75 |
| to their local/resident supplier of services | WC 160 | 0.00 | 0.61 | 0.00 | 0.61 | 0.01 |
| other than those covered by other rates of withholding tax | WC 160 | 0.00 | 27.85 | 0.00 | 27.85 | 0.56 |
| withholding tax | WC 160 | 0.00 | 0.28 | 0.00 | 0.28 | 0.01 |
| Total |  | 0.00 | 216.09 | 0.00 | 216.09 | 4.33 |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.taxBase, 216.09);
  assert.equal(result.fields.taxWithheld, 4.33);
  assert.equal(result.fields.monthOfQuarter, "second");
});

test("post-processing clears annotation month when the total row spans multiple months", () => {
  const result = process({
    normalized: {
      periodStart: "04-01-2025",
      periodEnd: "06-30-2025",
      monthOfQuarter: "second",
      atcCode: "WC160",
      taxBase: 347687.46,
      taxWithheld: 6953.75,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
| Income Payments Subject to Expanded Withholding Tax | ATC | 1st Month of the Quarter | 2nd Month of the Quarter | 3rd Month of the Quarter | Total | Tax Withheld for the Quarter |
| Income Payment made by top withholding agents to their local/resident suppliers of services | WC160 | 51,675.41 | 93,120.95 | 202,891.10 | 347,687.46 | 6,953.75 |
| Total |  | 51,675.41 | 93,120.95 | 202,891.10 | 347,687.46 | 6,953.75 |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.taxBase, 347687.46);
  assert.equal(result.fields.taxWithheld, 6953.75);
  assert.equal(result.fields.monthOfQuarter, undefined);
});

test("post-processing ignores invalid month of quarter values", () => {
  const result = process({
    normalized: {
      periodEnd: "09-30-2026",
      monthOfQuarter: "fourth",
    },
  });

  assert.equal(result.fields.periodEnd, "09-30-2026");
  assert.equal(result.fields.monthOfQuarter, undefined);
});

test("post-processing recovers spaced item 1 period dates from zone fallback", () => {
  const result = process({
    normalized: {
      periodStart: null,
      periodCovered: null,
      periodEnd: null,
      confidences: {
        periodStart: 0,
        periodCovered: 0,
        periodEnd: 0,
      },
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: "| 1 | For the Period | From | 0 | 7 | 2 | 6 | 2 | 0 | 2 |",
        },
      ],
      zoneOcrFallbackText: [
        {
          zoneId: "payee_payor_info",
          text: [
            "1 For the Period From 0 7 2 6 2 0 2 5 (MM/DD/YYYY) To 0 8 2 5 2 0 2 5 (MM/DD/YYYY)",
            "Part I - Payee Information",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.periodStart, "07-26-2025");
  assert.equal(result.fields.periodCovered, "07-26-2025 to 08-25-2025");
  assert.equal(result.fields.periodEnd, "08-25-2025");
});

test("post-processing prefers clean header period zone over implausible annotation dates", () => {
  const result = process({
    normalized: {
      periodStart: "01-02-2002",
      periodCovered: "01-02-2002 to 08-30-2051",
      periodEnd: "08-30-2051",
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown:
            "1 For the Period From 09 01 2 02 51 MM DD YYYY To 08 30 2051 MM DD YYYY",
        },
      ],
      zoneOcrFallbackText: [
        {
          zoneId: "header_period",
          text: "1 For the Period From 09 01 2025 (MM/DD/YYYY) To 09 30 2025 (MM/DD/YYYY)",
        },
      ],
    }),
  });

  assert.equal(result.fields.periodStart, "09-01-2025");
  assert.equal(result.fields.periodCovered, "09-01-2025 to 09-30-2025");
  assert.equal(result.fields.periodEnd, "09-30-2025");
});

test("post-processing drops implausible period dates when no clean evidence is available", () => {
  const result = process({
    normalized: {
      periodStart: "01-02-2002",
      periodCovered: "01-02-2002 to 08-30-2051",
      periodEnd: "08-30-2051",
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown:
            "1 For the Period From 09 01 2 02 51 MM DD YYYY To 08 30 2051 MM DD YYYY",
        },
      ],
    }),
  });

  assert.equal(result.fields.periodStart, undefined);
  assert.equal(result.fields.periodCovered, undefined);
  assert.equal(result.fields.periodEnd, undefined);
  assert.ok(
    (result.fields.annotationWarnings as string[]).includes(
      "period evidence rejected: period_start_year_out_of_range",
    ),
  );
});

test("post-processing prefers boxed TIN rows over valid-length annotation output", () => {
  const result = process({
    normalized: {
      payeeName: "Therma Visayas, Inc. (TVI)",
      payeeTin: "105013161610101",
      payorName: "Camiguin Electric Cooperative, Inc.",
      payorTin: "001516172000",
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
| 2 Taxpayer Identification Number (TIN) |   | 01 01 5 | 01 31 1 | 61 61 3 | 01 01 01 |  |   |
| 3 Payee's Name |
| Therma Visayas, Inc. (TVI) |
| 6 Taxpayer Identification Number (TIN) |   | 01 01 0 | 51 61 9 | 01 71 2 | 01 01 01 |  |   |
| 7 Payor's Name |
| Camiguin Electric Cooperative, Inc. |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.payeeTin, "005031663000");
  assert.equal(result.fields.payorTin, "000569072000");
});

test("post-processing decodes merged boxed TIN cells from zone fallback", () => {
  const result = process({
    normalized: {
      payorName: "Camiguin Electric Cooperative, Inc.",
      payorTin: "001516172000",
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
| 7 Payor's Name |
| Camiguin Electric Cooperative, Inc. |
`,
        },
      ],
      zoneOcrFallbackText: [
        {
          zoneId: "payee_payor_info",
          text: "|  6 Taxpayer Identification Number (TIN) | 010 0 | - | 516 9 | - | 017 2 | - | 010 10 | | |   |",
        },
      ],
    }),
  });

  assert.equal(result.fields.payorTin, "000569072000");
});

test("post-processing decodes standard grouped TIN cells from party rows", () => {
  const result = process({
    normalized: {
      payeeTin: "000534416000",
      payorTin: "000534416000",
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
| 2 Taxpayer Identification Number (TIN) |   | 267 | 090 | 070 | 00000 |  |   |
| 6 Taxpayer Identification Number (TIN) |   | 0 0 0 | 5 3 4 | 4 1 8 | 0 0 0 |  |   |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.payeeTin, "26709007000000");
  assert.equal(result.fields.payorTin, "000534418000");
});

test("post-processing corrects swapped payee and payor fields from item rows", () => {
  const result = process({
    normalized: {
      payeeName: "BOHOL I ELECTRIC COOPERATIVE INC",
      payeeTin: "000534416000",
      payeeAddress: "CABULIJAN TUBIGON BOHOL",
      payeeZip: "6329",
      payorName: "Therma Marine, Inc.",
      payorTin: "000534416000",
      payorAddress:
        "Mobile 2, Lawis, Santa Ana, Agusan Del Norte Philippines 8602 Philippines",
      payorZip: null,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: `
| Part I - Payee Information |
| 2 Taxpayer Identification Number (TIN) |   | 267 | 090 | 070 | 00000 |  |   |
| 3 Payee's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual) |
| Therma Marine, Inc. |
| 4 Registered Address |
| Mobile 2, Lawis, Santa Ana, Agusan Del Norte Philippines 8602 Philippines |
| 4A Zip Code 8602 |
| Part II - Payor Information |
| 6 Taxpayer Identification Number (TIN) |   | 0 0 0 | 5 3 4 | 4 1 6 | 0 0 0 |  |   |
| 7 Payor's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual) |
| BOHOL I ELECTRIC COOPERATIVE INC |
| 8 Registered Address |
| CABULIJAN TUBIGON BOHOL |
| 8A Zip Code 6329 |
`,
        },
      ],
      zoneOcrFallbackText: [
        {
          zoneId: "payee_payor_info",
          markdown: `
| Part I - Payee Information |
| 2 Taxpayer Identification Number (TIN) 267 090 070 00000 |
| 3 Payee's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual) Therma Marine, Inc. |
| 4 Registered Address Mobile 2, Lawis, Santa Ana, Agusan Del Norte Philippines 8602 Philippines |
| Part II - Payor Information |
| 6 Taxpayer Identification Number (TIN) 0 0 0 5 3 4 4 1 8 0 0 0 |
| 7 Payor's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual) BOHOL I ELECTRIC COOPERATIVE INC |
| 8 Registered Address CABULIJAN TUBIGON BOHOL |
`,
        },
      ],
    }),
  });

  assert.equal(result.fields.payeeName, "Therma Marine, Inc.");
  assert.equal(result.fields.payeeTin, "26709007000000");
  assert.equal(
    result.fields.payeeAddress,
    "Mobile 2, Lawis, Santa Ana, Agusan Del Norte Philippines 8602 Philippines",
  );
  assert.equal(result.fields.payeeZip, "8602");
  assert.equal(result.fields.payorName, "BOHOL I ELECTRIC COOPERATIVE INC");
  assert.equal(result.fields.payorTin, "000534418000");
  assert.equal(result.fields.payorAddress, "CABULIJAN TUBIGON BOHOL");
  assert.equal(result.fields.payorZip, "6329");
});

test("post-processing treats missing signature-region OCR as unknown, not false", () => {
  const result = process({
    normalized: {
      printedName: null,
      signaturePresent: false,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown:
            "Part III Details of Monthly Income Payments and Taxes Withheld\n*NOTE: The BIR Data Privacy is in the BIR website",
        },
      ],
    }),
  });

  assert.equal(result.fields.signaturePresent, undefined);
  assert.equal(result.fields.signature, undefined);
});

test("post-processing does not treat printed signer text alone as signed", () => {
  const result = process({
    normalized: {
      printedName: "LILIAN D. SARALDE",
      signatoryTitle: "Finance Manager",
      signatoryTin: "901-327-847-000",
      signaturePresent: null,
    },
    annotationRaw: {
      pages: [
        {
          markdown: "LILIAN D. SARALDE Finance Manager (901-327-847-000)",
        },
      ],
    },
  });

  assert.equal(result.fields.printedName, "LILIAN D. SARALDE");
  assert.equal(result.fields.signaturePresent, undefined);
  assert.equal(result.fields.signature, undefined);
});

test("post-processing keeps trusted annotation signer fields without parsing zone fallback", () => {
  const result = process({
    normalized: {
      printedName: "Raymundo, Marie Claire",
      signatoryTitle: "Chief Accountant",
      signatoryTin: "211-176-064",
      confidences: {
        printedName: 0.91,
        signatoryTitle: 0.9,
        signatoryTin: 0.92,
      },
      signaturePresent: null,
    },
    extraction: createTestExtraction({
      zoneOcrFallbackText: [
        {
          zoneId: "signature_block",
          text: [
            "Someone Else Finance Manager 901-327-847-000",
            "Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, "Raymundo, Marie Claire");
  assert.equal(result.fields.signatoryTitle, "Chief Accountant");
  assert.equal(result.fields.signatoryTin, "211176064");
  assert.equal(result.fields.signaturePresent, undefined);
});

test("post-processing keeps annotation signer fields when confidence is absent", () => {
  const result = process({
    normalized: {
      printedName: "LILIAN D. SARALDE",
      signatoryTitle: "Finance Manager",
      signatoryTin: "901-327-847-000",
    },
    extraction: createTestExtraction({
      zoneOcrFallbackText: [
        {
          zoneId: "signature_block",
          text: "SHARON ROSE Z. MEDINA / Manager Accounting / 201-308-097-000",
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, "LILIAN D. SARALDE");
  assert.equal(result.fields.signatoryTitle, "Finance Manager");
  assert.equal(result.fields.signatoryTin, "901327847000");
});

test("post-processing drops low-confidence signer fields instead of replacing them", () => {
  const result = process({
    normalized: {
      printedName: "REGULATORY AGENT DATE",
      signatoryTitle:
        "Authorized Representative Tax Agent Include Title Designation And Tni",
      signatoryTin: null,
      confidences: {
        printedName: 0,
        signatoryTitle: 0,
        signatoryTin: 0,
      },
      signaturePresent: null,
    },
    extraction: createTestExtraction({
      zoneOcrFallbackText: [
        {
          zoneId: "signature_block",
          text: [
            "Raymundo, Marie Claire Chief Accountant 211-176-064 SM 6/25/2025",
            "Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent (Indicate Title/Designation and TIN)",
            "CONFORME:",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, undefined);
  assert.equal(result.fields.signatoryTitle, undefined);
  assert.equal(result.fields.signatoryTin, undefined);
  assert.equal(result.fields.signaturePresent, undefined);
});

test("post-processing treats confidence 0.2 signer fields as missing", () => {
  const result = process({
    normalized: {
      printedName: "Borderline Name",
      signatoryTitle: "Borderline Title",
      signatoryTin: "123-456-789",
      confidences: {
        printedName: 0.2,
        signatoryTitle: 0.2,
        signatoryTin: 0.2,
      },
    },
  });

  assert.equal(result.fields.printedName, undefined);
  assert.equal(result.fields.signatoryTitle, undefined);
  assert.equal(result.fields.signatoryTin, undefined);
});

test("post-processing does not infer signer fields from zone fallback when annotation is null", () => {
  const result = process({
    normalized: {
      printedName: null,
      signatoryTitle: null,
      signatoryTin: null,
      confidences: {
        printedName: 0.9,
        signatoryTitle: 0.9,
        signatoryTin: 0.9,
      },
    },
    extraction: createTestExtraction({
      zoneOcrFallbackText: [
        {
          zoneId: "signature_block",
          text: [
            "Raymundo, Marie Claire Chief Accountant 211-176-064 SM 6/25/2025",
            "Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent (Indicate Title/Designation and TIN)",
            "CONFORME:",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, undefined);
  assert.equal(result.fields.signatoryTitle, undefined);
  assert.equal(result.fields.signatoryTin, undefined);
});

test("post-processing recovers multiline payor signer when visual signature is detected", () => {
  const result = process({
    normalized: {
      isBir2307: true,
      printedName: null,
      signatoryTitle: null,
      signatoryTin: null,
      signaturePresent: null,
    },
    signatureVisualDetection: {
      status: "detected",
      signaturePresent: true,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: [
            "BIR Form No. 2307",
            "We declare under the penalties of perjury that this certificate has been made in good faith.",
            "NIKKO MIGUEL A. ANGSICO",
            "Head- Tax Realty and Contract Management",
            "TIN: 312-635-478",
            "Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent",
            "CONFORME:",
            "THERMA SOUTH, INC.",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, "NIKKO MIGUEL A. ANGSICO");
  assert.equal(
    result.fields.signatoryTitle,
    "Head- Tax Realty and Contract Management",
  );
  assert.equal(result.fields.signatoryTin, "312635478");
  assert.deepEqual(
    (
      result.fields.normalizerPayload as Record<string, Record<string, unknown>>
    ).signerTextFallback.status,
    "recovered",
  );
});

test("post-processing ignores telephone rows during signer recovery", () => {
  const result = process({
    normalized: {
      isBir2307: true,
      printedName: null,
      signatoryTitle: null,
      signatoryTin: null,
      signaturePresent: null,
    },
    signatureVisualDetection: {
      status: "detected",
      signaturePresent: true,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: [
            "BIR Form No. 2307",
            "Further, we give our consent under the Data Privacy Act.",
            "NAKO MIGUEL A. ANGELO",
            "Head, Tax Realty and Contract Management",
            "Tel: 310-620-478",
            "Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent",
            "CONFORME:",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, "NAKO MIGUEL A. ANGELO");
  assert.equal(
    result.fields.signatoryTitle,
    "Head, Tax Realty and Contract Management",
  );
  assert.equal(result.fields.signatoryTin, undefined);
});

test("post-processing recovers slash-separated payor signer fields", () => {
  const result = process({
    normalized: {
      isBir2307: true,
      printedName: null,
      signatoryTitle: null,
      signatoryTin: null,
      signaturePresent: null,
    },
    signatureVisualDetection: {
      status: "detected",
      signaturePresent: true,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: [
            "| BIR Form No. 2307 | | | | | | | | |",
            "| We declare under the penalties of perjury that this certificate has been made in good faith. | | | | | | | | |",
            "| JANE J. PASCO / Accounting Manager / 171-371-083-000 | | | | | | | | |",
            "| Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent (Indicate Title/Designation and TIN) | | | | | | | | |",
            "| CONFORME: | | | | | | | | |",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, "JANE J. PASCO");
  assert.equal(result.fields.signatoryTitle, "Accounting Manager");
  assert.equal(result.fields.signatoryTin, "171371083000");
});

test("post-processing does not recover signer fields without a valid pre-conforme signer", () => {
  const result = process({
    normalized: {
      isBir2307: true,
      printedName: null,
      signatoryTitle: null,
      signatoryTin: null,
      signaturePresent: null,
    },
    signatureVisualDetection: {
      status: "detected",
      signaturePresent: true,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: [
            "BIR Form No. 2307",
            "We declare under the penalties of perjury that this certificate has been made in good faith.",
            "JAG",
            "Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
            "CONFORME:",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, undefined);
  assert.equal(result.fields.signatoryTitle, undefined);
  assert.equal(result.fields.signatoryTin, undefined);
  assert.equal(
    (
      result.fields.normalizerPayload as Record<string, Record<string, unknown>>
    ).signerTextFallback.status,
    "not_found",
  );
});

test("post-processing does not recover lower conforme signer fields", () => {
  const result = process({
    normalized: {
      isBir2307: true,
      printedName: null,
      signatoryTitle: null,
      signatoryTin: null,
      signaturePresent: null,
    },
    signatureVisualDetection: {
      status: "detected",
      signaturePresent: true,
    },
    extraction: createTestExtraction({
      pages: [
        {
          markdown: [
            "BIR Form No. 2307",
            "CONFORME:",
            "THERMA SOUTH, INC.",
            "267-447-083-000",
            "Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent",
          ].join("\n"),
        },
      ],
    }),
  });

  assert.equal(result.fields.printedName, undefined);
  assert.equal(result.fields.signatoryTitle, undefined);
  assert.equal(result.fields.signatoryTin, undefined);
});

test("post-processing preserves visible payor signature annotations", () => {
  const result = process({
    normalized: {
      printedName: "LILIAN D. SARALDE",
      signaturePresent: true,
    },
    annotationRaw: {
      pages: [
        {
          markdown:
            "LILIAN D. SARALDE\nSignature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
          blocks: [
            {
              type: "signature",
              content: "LILIAN D. SARALDE",
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.fields.signaturePresent, true);
  assert.equal(result.fields.signature, true);
});

test("post-processing ignores lower CONFORME block when payor block is absent", () => {
  const result = process({
    normalized: {
      signaturePresent: false,
    },
    annotationRaw: {
      pages: [
        {
          markdown:
            "CONFORME:\nSignature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent",
        },
      ],
    },
  });

  assert.equal(result.fields.signaturePresent, undefined);
});
