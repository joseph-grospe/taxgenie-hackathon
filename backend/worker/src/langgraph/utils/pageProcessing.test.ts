import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  getExtractionPlainText,
  getMainExtractionPlainText,
  classifyPageText,
  getExtractionText,
  splitPdfPages,
} from "./pageProcessing.ts";

test("splitPdfPages returns stable 1-based page numbers", async () => {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  document.addPage([200, 200]);
  document.addPage([200, 200]);

  const pages = await splitPdfPages(Buffer.from(await document.save()));

  assert.equal(pages.length, 3);
  assert.deepEqual(
    pages.map((page) => page.pageNumber),
    [1, 2, 3],
  );
  assert.ok(pages.every((page) => page.content.length > 0));
});

test("splitPdfPages produces deterministic bytes for persistence reconstruction", async () => {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  const source = Buffer.from(await document.save());

  const first = await splitPdfPages(source);
  const second = await splitPdfPages(source);

  assert.equal(
    first[0]?.content.equals(second[0]?.content ?? Buffer.alloc(0)),
    true,
  );
});

test("classifyPageText marks obvious BIR 2307 content as certificate", () => {
  const classification = classifyPageText(`
    Certificate of Creditable Tax Withheld at Source
    BIR Form No. 2307
    Payee: Example Supplier
    Payor: Example Customer
    ATC: WI010
    Tax Withheld: 1000.00
  `);

  assert.equal(classification, "certificate");
});

test("classifyPageText marks official BIR 2307 OCR header as certificate", () => {
  const classification = classifyPageText(`
    For BIR BCS/ Use Only Item:

    Republic of the Philippines
    Department of Finance
    Bureau of Internal Revenue

    | BIR Form No.
    2307
    January 2018 (ENCS) | | Certificate of Creditable Tax
    Withheld at Source | | | | | | | | | 2307.01/18ENCS |
  `);

  assert.equal(classification, "certificate");
});

test("classifyPageText recognizes markdown table OCR with noisy BIR-only header", () => {
  const classification = classifyPageText(`
    For BIR BCS/ Use Only item

    BIRMINGEAL OY

    Republic of the Philippines
    Department of Finance
    Bureau of Internal Revenue

    |  BIR Form No.
    2307
    January 2018 (ENCS) | Certificate of Creditable
    Withheld At Source |   |   |   |   | 2307 01/18ENCS  |   |
    | --- | --- | --- | --- | --- | --- | --- | --- |
    |  Fill in all applicable spaces. Mark all appropriate boxes with an "X".  |   |   |   |   |   |   |   |
    |  1 For the Period From 09/01/2025 (MM/DD/YYYY) To 09/30/2025 (MM/DD/YYYY)  |   |   |   |   |   |   |   |
    |  Part I - Payee Information  |   |   |   |   |   |   |   |
    |  2 Taxpayer Identification Number (TIN) 004-760-842-0000  |   |   |   |   |   |   |   |
  `);

  assert.equal(classification, "certificate");
});

test("classifyPageText ignores generic non-certificate pages", () => {
  const classification = classifyPageText(`
    Cover sheet
    Attached are the documents for this month.
    Please review the memo and supporting schedule.
  `);

  assert.equal(classification, "non_certificate");
});

test("getExtractionText falls back to raw markdown when parsedText is missing", () => {
  const extracted = getExtractionText({
    provider: "test",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    raw: {
      pages: [
        {
          markdown: `
            Republic of the Philippines
            Department of Finance
            Bureau of Internal Revenue
            BIR Form No. 2307
            Certificate of Creditable Tax Withheld at Source
          `,
        },
      ],
    },
    metadata: {},
  });

  assert.ok(extracted.includes("republic of the philippines"));
  assert.equal(classifyPageText(extracted), "certificate");
});

test("getExtractionPlainText preserves raw markdown for BIR 2307 table OCR", () => {
  const markdown = `
    For BIR BCS/ Use Only Item
    Republic of the Philippines
    Department of Finance
    Bureau of Internal Revenue

    | BIR Form No.
    2307
    January 2018 (ENCS) | Certificate of Creditable Tax
    Withheld At Source |
    | 1 For the Period | From | 01 | 01 | 2024 | To | 03 | 31 | 2024 |
    | Part I - Payee Information |
    | THERMA MARINE, INC. |
    | PART III - Details of Monthly Income Payments and Tax Withheld for the Quarter |
    | WC160 | 289.93 | PHP 5.80 |
  `;
  const plain = getExtractionPlainText({
    provider: "test",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    raw: {
      pages: [{ markdown }],
    },
    metadata: {},
  });

  assert.ok(plain?.includes("BIR Form No."));
  assert.equal(classifyPageText(plain ?? ""), "certificate");
});

test("getExtractionPlainText falls back to structured OCR field values", () => {
  const plain = getExtractionPlainText({
    provider: "test",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    raw: {
      data: {
        birForm: {
          formNumber: { value: "2307", type: "string" },
        },
        certificate: {
          title: {
            value: "Certificate of Creditable Tax Withheld at Source",
            type: "string",
          },
        },
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
            total: { value: 1.22, type: "number" },
            taxWithheld: { value: 0.02, type: "number" },
          },
        ],
      },
    },
    metadata: {},
  });

  assert.ok(plain?.includes("payee Information TIN: 267-090-070-00000"));
  assert.ok(plain?.includes("income Payments tax Withheld: 0.02"));
  assert.equal(
    getExtractionText({
      provider: "test",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      raw: {
        data: {
          certificate: {
            title: {
              value: "Certificate of Creditable Tax Withheld at Source",
              type: "string",
            },
          },
          birForm: {
            formNumber: { value: "2307", type: "string" },
          },
        },
      },
      metadata: {},
    }).includes("certificate of creditable tax withheld at source"),
    true,
  );
});

test("getExtractionPlainText keeps structured OCR fields with parsed text", () => {
  const plain = getExtractionPlainText({
    provider: "test",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    parsedText: "BIR Form No. 2307",
    raw: {
      data: {
        payeeInformation: {
          name: { value: "THERMA MARINE, INC.", type: "string" },
        },
      },
    },
    metadata: {},
  });

  assert.ok(plain?.includes("BIR Form No. 2307"));
  assert.ok(plain?.includes("payee Information name: THERMA MARINE, INC."));
});

test("getMainExtractionPlainText excludes appended zone fallback sections", () => {
  const plain = getMainExtractionPlainText({
    provider: "test",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    raw: {},
    parsedText:
      "Main OCR text\n\n[Zone OCR fallback: payee_payor_info]\nFallback text",
    metadata: {},
  });

  assert.equal(plain, "Main OCR text");
});
