import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCertificateMetadataFields,
  parseCertificateFileName,
} from './certificate-filename'

test('parseCertificateFileName parses standard BIR2307 certificate names', () => {
  assert.deepEqual(
    parseCertificateFileName(
      'BIR2307_ACME_CLIENTABC_SETT123_0825_20250903.pdf',
    ),
    {
      documentType: 'BIR2307',
      issuerShortname: 'ACME',
      recipientShortname: 'CLIENTABC',
      settlementReferenceNumber: 'SETT123',
      billingMonthMMYY: '0825',
      dateUploaded: '20250903',
      normalizedIssuerShortname: 'ACME',
    },
  )
})

test('parseCertificateFileName parses parenthetical duplicate suffixes', () => {
  assert.deepEqual(
    parseCertificateFileName(
      'BIR2307_BILECO_EAUC_0044796_0825_20251003 (1).pdf',
    ),
    {
      documentType: 'BIR2307',
      issuerShortname: 'BILECO',
      recipientShortname: 'EAUC',
      settlementReferenceNumber: '0044796',
      billingMonthMMYY: '0825',
      dateUploaded: '20251003',
      normalizedIssuerShortname: 'BILECO',
    },
  )
})

test('parseCertificateFileName parses numeric hyphen upload suffixes', () => {
  assert.deepEqual(
    parseCertificateFileName(
      'BIR2307_VMC_EAUC_2340050455_1225_20260122-2.pdf',
    ),
    {
      documentType: 'BIR2307',
      issuerShortname: 'VMC',
      recipientShortname: 'EAUC',
      settlementReferenceNumber: '2340050455',
      billingMonthMMYY: '1225',
      dateUploaded: '20260122',
      normalizedIssuerShortname: 'VMC',
    },
  )
})

test('buildCertificateMetadataFields returns database metadata for numeric hyphen suffixes', () => {
  assert.deepEqual(
    buildCertificateMetadataFields(
      'BIR2307_VMC_EAUC_2340050455_1225_20260122-2.pdf',
    ),
    {
      certificateDocumentType: 'BIR2307',
      certificateIssuerShortName: 'VMC',
      certificateIssuerShortNameNormalized: 'VMC',
      certificateRecipientShortName: 'EAUC',
      certificateSettlementReferenceNumber: '2340050455',
      certificateBillingMonthMMYY: '1225',
      certificateDateUploaded: '20260122',
    },
  )
})

test('parseCertificateFileName rejects non-numeric date suffixes', () => {
  assert.equal(
    parseCertificateFileName(
      'BIR2307_VMC_EAUC_2340050455_1225_20260122-copy.pdf',
    ),
    null,
  )
})
