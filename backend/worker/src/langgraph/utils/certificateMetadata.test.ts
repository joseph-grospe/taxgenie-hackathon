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

test("buildCertificateMetadataResult derives high-confidence metadata for generic filenames", () => {
  const result = buildCertificateMetadataResult({
    originalFileName: "test_file_2307.pdf",
    isCertificate: true,
    normalized: {
      periodEnd: "09-30-2025",
      monthOfQuarter: "second",
    },
    resultColumns,
  });

  assert.deepEqual(result.fields, {
    certificateDocumentType: "BIR2307",
    certificateIssuerShortName: "ACME",
    certificateIssuerShortNameNormalized: "ACME",
    certificateRecipientShortName: "TMI",
    certificateSettlementReferenceNumber: null,
    certificateBillingMonthMMYY: "0825",
    certificateDateUploaded: null,
  });
  assert.deepEqual(result.matchMetadata, {
    documentType: "BIR2307",
    normalizedIssuerShortname: "ACME",
    billingMonthMMYY: "0825",
  });
});

test("buildCertificateMetadataResult does not synthesize unprovable fields", () => {
  const result = buildCertificateMetadataResult({
    originalFileName: "test_file_2307.pdf",
    isCertificate: true,
    normalized: {
      periodEnd: "09-30-2025",
      monthOfQuarter: "third",
    },
    resultColumns,
  });

  assert.equal(result.fields.certificateSettlementReferenceNumber, null);
  assert.equal(result.fields.certificateDateUploaded, null);
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
