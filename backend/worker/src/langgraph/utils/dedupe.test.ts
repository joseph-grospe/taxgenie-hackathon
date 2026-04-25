import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBatchDataFingerprint,
  buildNormalizedDataFingerprint,
  collectCurrentCertificatePageFingerprints,
  collectCurrentCertificateDataFingerprints,
  collectStoredDataFingerprints,
  collectStoredPageFingerprints,
  extractStoredSourceHash,
  matchCurrentPagesToStoredDuplicates,
} from "./dedupe.ts";

test("buildNormalizedDataFingerprint normalizes equivalent certificate data", () => {
  const left = buildNormalizedDataFingerprint({
    periodCovered: "08-01-2025 to 08-31-2025",
    periodEnd: "08-31-2025",
    payeeName: "EAST ASIA UTILITIES CORPORATION",
    payeeTin: "004-760-842-000",
    payorName: "1590 ENERGY CORP",
    payorTin: "007-833-205-000",
    atcCode: "WC160",
    taxBase: "10,201.33",
    taxWithheld: "204.03",
    signaturePresent: true,
  });
  const right = buildNormalizedDataFingerprint({
    periodCovered: "2025-08-01 to 2025-08-31",
    periodEnd: "0831 2025",
    payeeName: " east asia utilities corporation ",
    payeeTin: "004760842000",
    payorName: "1590 energy corp",
    payorTin: "007833205000",
    atcCode: "wc-160",
    taxBase: 10201.33,
    taxWithheld: "204.030",
    signaturePresent: "true",
  });

  assert.ok(left);
  assert.equal(left, right);
});

test("collectCurrentCertificateDataFingerprints only includes certificate pages", () => {
  const fingerprints = collectCurrentCertificateDataFingerprints([
    {
      pageNumber: 1,
      classification: "certificate",
      normalized: {
        payeeName: "A",
        payeeTin: "001-002-003-000",
        taxBase: "1,000.00",
      },
    },
    {
      pageNumber: 2,
      classification: "non_certificate",
      normalized: {
        payeeName: "A",
        payeeTin: "001-002-003-000",
        taxBase: "1,000.00",
      },
    },
  ]);

  assert.equal(fingerprints.length, 1);
});

test("collectCurrentCertificatePageFingerprints keeps page numbers for certificate pages", () => {
  const fingerprints = collectCurrentCertificatePageFingerprints([
    {
      pageNumber: 1,
      classification: "certificate",
      normalized: {
        payeeName: "A",
        payeeTin: "001-002-003-000",
        taxBase: "1,000.00",
      },
    },
    {
      pageNumber: 2,
      classification: "non_certificate",
      normalized: {
        payeeName: "B",
        payeeTin: "009-008-007-000",
        taxBase: "2,000.00",
      },
    },
  ]);

  assert.deepEqual(fingerprints, [
    {
      pageNumber: 1,
      dataFingerprint: fingerprints[0]?.dataFingerprint,
    },
  ]);
});

test("buildBatchDataFingerprint is stable across ordering", () => {
  const left = buildBatchDataFingerprint(["b", "a", "a"]);
  const right = buildBatchDataFingerprint(["a", "b"]);

  assert.ok(left);
  assert.equal(left, right);
});

test("extractStoredSourceHash prefers persisted dedupe source hash", () => {
  const hash = extractStoredSourceHash({
    dedupe: { sourceHash: "ABC123" },
    source: { hash: "ignored" },
  });

  assert.equal(hash, "abc123");
});

test("collectStoredDataFingerprints reads persisted certificate and upload payloads", () => {
  const direct = collectStoredDataFingerprints({
    dedupe: { dataFingerprint: "fingerprint-a" },
    normalized: {
      payeeName: "Example",
    },
  });
  const uploadLevel = collectStoredDataFingerprints({
    pages: [
      {
        normalized: {
          payeeName: "Example",
          payeeTin: "001-002-003-000",
          taxBase: "1,000.00",
        },
      },
    ],
  });

  assert.ok(direct.includes("fingerprint-a"));
  assert.equal(uploadLevel.length, 1);
});

test("collectStoredPageFingerprints reads persisted page fingerprints with page numbers", () => {
  const storedPages = collectStoredPageFingerprints({
    pages: [
      {
        pageNumber: 3,
        dedupe: { dataFingerprint: "fingerprint-a" },
      },
      {
        pageNumber: 4,
        normalized: {
          payeeName: "Example",
          payeeTin: "001-002-003-000",
          taxBase: "1,000.00",
        },
      },
    ],
  });

  assert.deepEqual(storedPages[0], {
    pageNumber: 3,
    dataFingerprint: "fingerprint-a",
  });
  assert.equal(storedPages[1]?.pageNumber, 4);
  assert.ok(storedPages[1]?.dataFingerprint);
});

test("matchCurrentPagesToStoredDuplicates identifies the current page and existing page", () => {
  const currentFingerprint = buildNormalizedDataFingerprint({
    periodCovered: "08-01-2025 to 08-31-2025",
    periodEnd: "08-31-2025",
    payeeName: "EAST ASIA UTILITIES CORPORATION",
    payeeTin: "004-760-842-000",
    payorName: "1590 ENERGY CORP",
    payorTin: "007-833-205-000",
    atcCode: "WC160",
    taxBase: "10,201.33",
    taxWithheld: 204.03,
  });

  assert.ok(currentFingerprint);

  const matches = matchCurrentPagesToStoredDuplicates(
    [
      {
        pageNumber: 2,
        dataFingerprint: currentFingerprint,
      },
    ],
    [
      {
        pageNumber: 7,
        dataFingerprint: currentFingerprint,
        existingFileName: "existing-certificate.pdf",
        matchedVia: "certificate",
      },
    ],
  );

  assert.deepEqual(matches, [
    {
      currentPageNumber: 2,
      existingPageNumber: 7,
      existingFileName: "existing-certificate.pdf",
      matchedVia: "certificate",
    },
  ]);
});
