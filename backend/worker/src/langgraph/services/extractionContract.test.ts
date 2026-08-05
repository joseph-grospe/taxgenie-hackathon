import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_EXTRACTION_PROMPT,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
  documentExtractionResultSchema,
  validateDocumentExtractionPages,
} from "./extractionContract.ts";
import {
  SANITIZED_TWO_ATC_EXTRACTION_TOTALS,
  SANITIZED_TWO_ATC_TAX_ROWS,
} from "../testFixtures/sanitizedTwoAtcCertificate.ts";
import { canonicalizeExtractedCertificate } from "../utils/agenticExtraction.ts";

const certificate = {
  certificateKey: "certificate-1",
  pageNumbers: [1],
  period: {
    start: "2026-04-01",
    end: "2026-06-30",
    monthOfQuarter: "first" as const,
  },
  payee: {
    name: "PAYEE",
    tin: "00503166300000",
    address: null,
    zip: null,
  },
  payor: {
    name: "PAYOR",
    tin: "0002025240000",
    address: null,
    zip: null,
  },
  taxRows: [
    {
      lineNumber: 1,
      pageNumber: 1,
      atcCode: "WC160",
      description: null,
      monthlyAmounts: {
        first: "100.00",
        second: null,
        third: null,
      },
      taxBase: "100.00",
      taxRate: "0.020000",
      taxWithheld: "2.00",
    },
  ],
  primaryAtcCode: "WC160",
  totals: { taxBase: "100.00", taxWithheld: "2.00" },
  signer: {
    printedName: null,
    title: null,
    tin: null,
    companyName: null,
    signature: {
      present: false,
      confidence: 0.2,
      pageNumber: null,
      source: "gemini" as const,
    },
  },
  confidence: {
    period: 0.9,
    payee: 0.9,
    payor: 0.9,
    taxRows: 0.9,
    signer: 0.5,
  },
  evidence: {},
  warnings: [],
};

const result = {
  schemaVersion: 1 as const,
  classification: {
    documentType: "BIR_2307" as const,
    confidence: 0.95,
    pageCount: 1,
  },
  certificates: [certificate],
};

test("agentic extraction schema accepts strict structured values without OCR text", () => {
  assert.deepEqual(documentExtractionResultSchema.parse(result), result);
  assert.equal("ocrText" in result, false);
});

test("agentic extraction defines pageCount as every physical PDF page", () => {
  assert.equal(
    DOCUMENT_EXTRACTION_PROMPT_VERSION,
    "bir2307-agentic-v6-physical-page-count",
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /total number of physical PDF pages, including completely blank pages/iu,
  );
  assert.match(
    JSON.stringify(DOCUMENT_EXTRACTION_RESPONSE_SCHEMA),
    /Total number of physical PDF pages, including completely blank pages/iu,
  );
});

test("agentic extraction preserves two populated ATC rows independently", () => {
  const multiAtcCertificate = {
    ...certificate,
    period: { ...certificate.period, monthOfQuarter: "second" as const },
    taxRows: SANITIZED_TWO_ATC_TAX_ROWS,
    primaryAtcCode: "WC157",
    totals: SANITIZED_TWO_ATC_EXTRACTION_TOTALS,
  };

  const parsed = documentExtractionResultSchema.parse({
    ...result,
    certificates: [multiAtcCertificate],
  });
  const normalized = canonicalizeExtractedCertificate(parsed.certificates[0]!);

  assert.deepEqual(
    normalized.taxRows.map((row) => row.atcCode),
    ["WC157", "WV020"],
  );
  assert.equal(normalized.period.monthOfQuarter, "second");
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /one taxRows entry for every active ATC row/iu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /Do not return rows containing only an ATC code or description.*blank or shown as dashes/isu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /explicitly printed "0\.00" is numeric and makes the row active/iu,
  );
});

test("agentic extraction preserves genuinely missing source fields as null", () => {
  const missingFields = {
    ...certificate,
    period: {
      start: null,
      end: null,
      monthOfQuarter: null,
    },
    payee: { ...certificate.payee, name: null, tin: null },
    payor: { ...certificate.payor, name: null, tin: null },
    taxRows: [],
    primaryAtcCode: null,
    totals: { taxBase: null, taxWithheld: null },
  };

  const parsed = documentExtractionResultSchema.parse({
    ...result,
    certificates: [missingFields],
  });

  assert.deepEqual(parsed.certificates[0], missingFields);
  assert.match(DOCUMENT_EXTRACTION_PROMPT, /return null/iu);
  assert.match(DOCUMENT_EXTRACTION_PROMPT, /never replace.*NOT PROVIDED/isu);
});

test("canonicalization turns model placeholder text back into missing values", () => {
  const parsed = documentExtractionResultSchema.parse({
    ...result,
    certificates: [
      {
        ...certificate,
        payee: { ...certificate.payee, name: "UNKNOWN", tin: "N/A" },
        payor: {
          ...certificate.payor,
          name: "NOT PROVIDED",
          tin: "NONE",
        },
        primaryAtcCode: "NULL",
      },
    ],
  });

  const normalized = canonicalizeExtractedCertificate(parsed.certificates[0]!);
  assert.equal(normalized.payee.name, null);
  assert.equal(normalized.payee.tin, null);
  assert.equal(normalized.payor.name, null);
  assert.equal(normalized.payor.tin, null);
  assert.equal(normalized.primaryAtcCode, null);
});

test("canonicalization recovers monthOfQuarter from the only non-zero monthly column", () => {
  const parsed = documentExtractionResultSchema.parse({
    ...result,
    certificates: [
      {
        ...certificate,
        period: { ...certificate.period, monthOfQuarter: null },
        taxRows: [
          {
            ...certificate.taxRows[0],
            monthlyAmounts: {
              first: "77306569.18",
              second: "0.00",
              third: "0.00",
            },
            taxBase: "77306569.18",
            taxWithheld: "3865328.49",
          },
        ],
        totals: {
          taxBase: "77306569.18",
          taxWithheld: "3865328.49",
        },
      },
    ],
  });

  const normalized = canonicalizeExtractedCertificate(parsed.certificates[0]!);
  assert.equal(normalized.period.monthOfQuarter, "first");
});

test("canonicalization clears monthOfQuarter when multiple monthly columns are non-zero", () => {
  const parsed = documentExtractionResultSchema.parse({
    ...result,
    certificates: [
      {
        ...certificate,
        taxRows: [
          {
            ...certificate.taxRows[0],
            monthlyAmounts: {
              first: "60.00",
              second: "40.00",
              third: "0.00",
            },
          },
        ],
      },
    ],
  });

  const normalized = canonicalizeExtractedCertificate(parsed.certificates[0]!);
  assert.equal(normalized.period.monthOfQuarter, null);
});

test("canonicalization clears monthOfQuarter when monthly columns are all zero", () => {
  const parsed = documentExtractionResultSchema.parse({
    ...result,
    certificates: [
      {
        ...certificate,
        taxRows: [
          {
            ...certificate.taxRows[0],
            monthlyAmounts: {
              first: "0.00",
              second: "0.00",
              third: "0.00",
            },
          },
        ],
      },
    ],
  });

  const normalized = canonicalizeExtractedCertificate(parsed.certificates[0]!);
  assert.equal(normalized.period.monthOfQuarter, null);
});

test("agentic prompt defines monthOfQuarter from monthly table columns", () => {
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /monthOfQuarter.*exactly one.*monthly columns.*non-zero/isu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /non-zero first amount.*zero second and third.*"first"/isu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /do not derive it from the period start\/end dates or the filename/iu,
  );
});

test("agentic signer contract is payor-only and stops at CONFORME", () => {
  assert.equal(
    DOCUMENT_EXTRACTION_PROMPT_VERSION,
    "bir2307-agentic-v6-physical-page-count",
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /signer always means the payor\/withholding-agent signer/iu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /Never combine a signature from one block with identity fields from the other/iu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /Stop reading signer fields at CONFORME/iu,
  );
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /lower payee block contains a clear printed name/iu,
  );
});

test("agentic extraction schema rejects unexpected properties, invalid dates, decimals, and totals", () => {
  for (const invalid of [
    { ...result, ocrText: "forbidden transcript" },
    {
      ...result,
      certificates: [
        {
          ...certificate,
          period: { ...certificate.period, start: "04-01-2026" },
        },
      ],
    },
    {
      ...result,
      certificates: [
        {
          ...certificate,
          taxRows: [{ ...certificate.taxRows[0], taxBase: "1,000.00" }],
        },
      ],
    },
    {
      ...result,
      certificates: [
        {
          ...certificate,
          totals: { ...certificate.totals, taxBase: "99.00" },
        },
      ],
    },
  ]) {
    assert.equal(
      documentExtractionResultSchema.safeParse(invalid).success,
      false,
    );
  }
});

test("page validation marks overlapping and out-of-range certificate assignments as errors", () => {
  const parsed = documentExtractionResultSchema.parse({
    ...result,
    classification: { ...result.classification, pageCount: 3 },
    certificates: [
      { ...certificate, pageNumbers: [1, 2] },
      {
        ...certificate,
        certificateKey: "certificate-2",
        pageNumbers: [2, 3],
        taxRows: [
          {
            ...certificate.taxRows[0],
            pageNumber: 3,
          },
        ],
      },
    ],
  });
  const issues = validateDocumentExtractionPages(parsed, 2);
  assert.ok(
    issues.some((issue) => issue.code === "overlapping_certificate_pages"),
  );
  assert.ok(
    issues.some((issue) => issue.code === "page_reference_out_of_range"),
  );
  assert.ok(issues.some((issue) => issue.code === "page_count_mismatch"));
});

test("page validation ignores only unreferenced blank physical pages", () => {
  const parsed = documentExtractionResultSchema.parse(result);
  const ignored = validateDocumentExtractionPages(parsed, 2, {
    ignoredBlankPageNumbers: [2],
  });
  assert.equal(
    ignored.some((issue) => issue.code === "page_count_mismatch"),
    false,
  );

  const referencedBlank = documentExtractionResultSchema.parse({
    ...result,
    certificates: [{ ...certificate, pageNumbers: [1, 2] }],
  });
  const retained = validateDocumentExtractionPages(referencedBlank, 2, {
    ignoredBlankPageNumbers: [2],
  });
  assert.equal(
    retained.some((issue) => issue.code === "page_count_mismatch"),
    true,
  );
});
