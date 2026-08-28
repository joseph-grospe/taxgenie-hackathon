import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCertificateMetadataResult,
  deriveCertificateBillingMonthMMYY,
} from "./certificateMetadata.ts";
import type { DocumentResultNormalizedColumns } from "./documentResultColumns.ts";

const resultColumns: DocumentResultNormalizedColumns = {
  periodEnd: "2025-09-30",
  payeeName: "Therma Mobile, Inc.",
  payeeTin: "266566116000",
  payeeShortName: "TMI",
  payorName: "Customer A",
  payorTin: "123456789000",
  payorShortName: "ACME",
};

test("deriveCertificateBillingMonthMMYY maps quarter placement to billing month", () => {
  assert.equal(
    deriveCertificateBillingMonthMMYY({
      periodEnd: "09-30-2025",
      monthOfQuarter: "second",
    }),
    "0825",
  );
});

test("buildCertificateMetadataResult derives metadata for unconventional filenames", () => {
  const result = buildCertificateMetadataResult({
    originalFileName: "01.26 BUSECO.pdf",
    isCertificate: true,
    normalized: {
      periodEnd: "03-31-2026",
      monthOfQuarter: "first",
    },
    resultColumns: {
      ...resultColumns,
      periodEnd: "2026-03-31",
      payorShortName: "BUSECO",
    },
    uploadedAt: "2026-07-27T23:30:00.000Z",
  });

  assert.deepEqual(result.fields, {
    certificateDocumentType: "BIR2307",
    certificateIssuerShortName: "BUSECO",
    certificateIssuerShortNameNormalized: "BUSECO",
    certificateRecipientShortName: "TMI",
    certificateSettlementReferenceNumber: null,
    certificateBillingMonthMMYY: "0126",
    certificateDateUploaded: "20260727",
  });
  assert.deepEqual(result.matchMetadata, {
    documentType: "BIR2307",
    normalizedIssuerShortname: "BUSECO",
    billingMonthMMYY: "0126",
  });
});

test("buildCertificateMetadataResult leaves unresolved short names and settlement reference null", () => {
  const result = buildCertificateMetadataResult({
    originalFileName: "test_file_2307.pdf",
    isCertificate: true,
    normalized: {
      periodEnd: "09-30-2025",
      monthOfQuarter: "third",
    },
    resultColumns: {
      ...resultColumns,
      payeeShortName: null,
      payorShortName: null,
    },
    uploadedAt: "2026-07-27T23:30:00.000Z",
  });

  assert.equal(result.fields.certificateIssuerShortName, null);
  assert.equal(result.fields.certificateIssuerShortNameNormalized, null);
  assert.equal(result.fields.certificateRecipientShortName, null);
  assert.equal(result.fields.certificateSettlementReferenceNumber, null);
  assert.equal(result.fields.certificateDateUploaded, "20260727");
});

test("buildCertificateMetadataResult prefers filename metadata over fallbacks", () => {
  const result = buildCertificateMetadataResult({
    originalFileName: "BIR2307_FILECO_CLIENT_SETT1_0725_20250803.pdf",
    isCertificate: true,
    normalized: {
      periodEnd: "09-30-2025",
      monthOfQuarter: "second",
    },
    resultColumns,
    uploadedAt: "2026-07-27T23:30:00.000Z",
  });

  assert.deepEqual(result.fields, {
    certificateDocumentType: "BIR2307",
    certificateIssuerShortName: "FILECO",
    certificateIssuerShortNameNormalized: "FILECO",
    certificateRecipientShortName: "CLIENT",
    certificateSettlementReferenceNumber: "SETT1",
    certificateBillingMonthMMYY: "0725",
    certificateDateUploaded: "20250803",
  });
});
