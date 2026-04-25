import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  classifyPageText,
  findDuplicateCertificatePages,
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

test("findDuplicateCertificatePages reports duplicate certificate text", () => {
  const duplicates = findDuplicateCertificatePages([
    {
      pageNumber: 1,
      classification: "certificate",
      extraction: {
        provider: "test",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        raw: {},
        parsedText:
          "Certificate of Creditable Tax Withheld at Source BIR Form No. 2307 Payee Example Payor Example ATC WI010 Tax Withheld 1000.00",
        metadata: {},
      },
    },
    {
      pageNumber: 2,
      classification: "non_certificate",
      extraction: {
        provider: "test",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        raw: {},
        parsedText: "Cover sheet memo",
        metadata: {},
      },
    },
    {
      pageNumber: 3,
      classification: "certificate",
      extraction: {
        provider: "test",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        raw: {},
        parsedText:
          "Certificate of Creditable Tax Withheld at Source BIR Form No. 2307 Payee Example Payor Example ATC WI010 Tax Withheld 1000.00",
        metadata: {},
      },
    },
  ]);

  assert.deepEqual(duplicates, [
    {
      pageNumber: 3,
      duplicateOfPageNumber: 1,
    },
  ]);
});
