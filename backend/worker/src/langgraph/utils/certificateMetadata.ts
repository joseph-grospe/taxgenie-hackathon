import {
  normalizeIssuerShortname,
  parseCertificateFileName,
} from "@taxtrack/shared";
import { eq, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { intakeFiles } from "../../db/schema";
import type { DocumentResultNormalizedColumns } from "./documentResultColumns";
import { extractPeriodEndDate } from "./parsing";

type MetadataDb = Pick<DbClient, "update">;

export type CertificateMetadataFields = {
  certificateDocumentType: string | null;
  certificateIssuerShortName: string | null;
  certificateIssuerShortNameNormalized: string | null;
  certificateRecipientShortName: string | null;
  certificateSettlementReferenceNumber: string | null;
  certificateBillingMonthMMYY: string | null;
  certificateDateUploaded: string | null;
};

export type CertificateMatchMetadata = {
  documentType: string | null;
  normalizedIssuerShortname: string | null;
  billingMonthMMYY: string | null;
};

export type CertificateMetadataResult = {
  fields: CertificateMetadataFields;
  matchMetadata: CertificateMatchMetadata | null;
};

const MONTH_OF_QUARTER_INDEX: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
};

const emptyMetadataFields = (): CertificateMetadataFields => ({
  certificateDocumentType: null,
  certificateIssuerShortName: null,
  certificateIssuerShortNameNormalized: null,
  certificateRecipientShortName: null,
  certificateSettlementReferenceNumber: null,
  certificateBillingMonthMMYY: null,
  certificateDateUploaded: null,
});

const normalizeShortNameValue = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
};

const formatUploadedAtDate = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0"),
  ].join("");
};

const toMonthOfQuarterIndex = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  return MONTH_OF_QUARTER_INDEX[value.trim().toLowerCase()] ?? null;
};

export function deriveCertificateBillingMonthMMYY(
  normalized: Record<string, unknown> | undefined,
): string | null {
  const periodEnd = extractPeriodEndDate(
    normalized?.periodEnd ?? normalized?.periodCovered,
  );
  if (!periodEnd) {
    return null;
  }

  const [yearPart, monthPart] = periodEnd.split("-");
  const year = Number(yearPart);
  const periodEndMonthIndex = Number(monthPart) - 1;
  if (
    !Number.isFinite(year) ||
    periodEndMonthIndex < 0 ||
    periodEndMonthIndex > 11
  ) {
    return null;
  }

  const monthOfQuarterIndex = toMonthOfQuarterIndex(
    normalized?.monthOfQuarter,
  );
  const billingMonthIndex =
    monthOfQuarterIndex === null
      ? periodEndMonthIndex
      : Math.floor(periodEndMonthIndex / 3) * 3 + monthOfQuarterIndex;
  if (billingMonthIndex < 0 || billingMonthIndex > 11) {
    return null;
  }

  return `${String(billingMonthIndex + 1).padStart(2, "0")}${String(
    year,
  ).slice(-2)}`;
}

export function buildCertificateMetadataResult(input: {
  originalFileName: string;
  isCertificate: boolean;
  normalized: Record<string, unknown> | undefined;
  resultColumns: DocumentResultNormalizedColumns;
  uploadedAt?: string | null;
}): CertificateMetadataResult {
  const parsed = parseCertificateFileName(input.originalFileName);
  const fallbackIssuerShortName = normalizeShortNameValue(
    input.resultColumns.payorShortName,
  );
  const issuerShortName = parsed?.issuerShortname ?? fallbackIssuerShortName;
  const normalizedIssuerShortName =
    parsed?.normalizedIssuerShortname ??
    (issuerShortName ? normalizeIssuerShortname(issuerShortName) : null);
  const documentType =
    parsed?.documentType ?? (input.isCertificate ? "BIR2307" : null);
  const billingMonthMMYY =
    parsed?.billingMonthMMYY ??
    deriveCertificateBillingMonthMMYY(input.normalized);

  const fields: CertificateMetadataFields = {
    ...emptyMetadataFields(),
    certificateDocumentType: documentType,
    certificateIssuerShortName: issuerShortName,
    certificateIssuerShortNameNormalized: normalizedIssuerShortName,
    certificateRecipientShortName:
      parsed?.recipientShortname ??
      normalizeShortNameValue(input.resultColumns.payeeShortName),
    certificateSettlementReferenceNumber:
      parsed?.settlementReferenceNumber ?? null,
    certificateBillingMonthMMYY: billingMonthMMYY,
    certificateDateUploaded:
      parsed?.dateUploaded ??
      (input.isCertificate ? formatUploadedAtDate(input.uploadedAt) : null),
  };

  const matchMetadata =
    documentType && normalizedIssuerShortName && billingMonthMMYY
      ? {
          documentType,
          normalizedIssuerShortname: normalizedIssuerShortName,
          billingMonthMMYY,
        }
      : null;

  return { fields, matchMetadata };
}

export async function persistIntakeFileCertificateMetadata(
  db: MetadataDb,
  uploadId: string,
  metadata: CertificateMetadataFields,
) {
  const hasValue = Object.values(metadata).some((value) => value !== null);
  if (!hasValue) {
    return;
  }

  await db
    .update(intakeFiles)
    .set({
      certificateDocumentType: sql`coalesce(
        ${intakeFiles.certificateDocumentType},
        ${metadata.certificateDocumentType}
      )`,
      certificateIssuerShortName: sql`coalesce(
        ${intakeFiles.certificateIssuerShortName},
        ${metadata.certificateIssuerShortName}
      )`,
      certificateIssuerShortNameNormalized: sql`coalesce(
        ${intakeFiles.certificateIssuerShortNameNormalized},
        ${metadata.certificateIssuerShortNameNormalized}
      )`,
      certificateRecipientShortName: sql`coalesce(
        ${intakeFiles.certificateRecipientShortName},
        ${metadata.certificateRecipientShortName}
      )`,
      certificateSettlementReferenceNumber: sql`coalesce(
        ${intakeFiles.certificateSettlementReferenceNumber},
        ${metadata.certificateSettlementReferenceNumber}
      )`,
      certificateBillingMonthMMYY: sql`coalesce(
        ${intakeFiles.certificateBillingMonthMMYY},
        ${metadata.certificateBillingMonthMMYY}
      )`,
      certificateDateUploaded: sql`coalesce(
        ${intakeFiles.certificateDateUploaded},
        ${metadata.certificateDateUploaded}
      )`,
      updatedAt: new Date(),
    })
    .where(eq(intakeFiles.id, uploadId));
}
