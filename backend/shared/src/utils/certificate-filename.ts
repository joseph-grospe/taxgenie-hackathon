export type ParsedCertificateFileMetadata = {
  documentType: string
  issuerShortname: string
  recipientShortname: string
  settlementReferenceNumber: string
  billingMonthMMYY: string
  dateUploaded: string
  normalizedIssuerShortname: string
}

export const normalizeIssuerShortname = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '')

export const parseCertificateFileName = (
  fileName: string,
): ParsedCertificateFileMetadata | null => {
  const match = fileName.match(
    /^([^_]+)_([^_]+)_([^_]+)_(.+)_(\d{4})_(\d{8})(?:\s+\(\d+\))?\.[^.]+$/i,
  )

  if (!match) {
    return null
  }

  return {
    documentType: match[1],
    issuerShortname: match[2],
    recipientShortname: match[3],
    settlementReferenceNumber: match[4],
    billingMonthMMYY: match[5],
    dateUploaded: match[6],
    normalizedIssuerShortname: normalizeIssuerShortname(match[2]),
  }
}

export const buildCertificateMetadataFields = (fileName: string) => {
  const parsed = parseCertificateFileName(fileName)

  return {
    certificateDocumentType: parsed?.documentType ?? null,
    certificateIssuerShortName: parsed?.issuerShortname ?? null,
    certificateIssuerShortNameNormalized:
      parsed?.normalizedIssuerShortname ?? null,
    certificateRecipientShortName: parsed?.recipientShortname ?? null,
    certificateSettlementReferenceNumber:
      parsed?.settlementReferenceNumber ?? null,
    certificateBillingMonthMMYY: parsed?.billingMonthMMYY ?? null,
    certificateDateUploaded: parsed?.dateUploaded ?? null,
  }
}
