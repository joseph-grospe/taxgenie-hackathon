import type { ExtractedCertificate } from "../services/extractionContract.ts";

interface FieldConfidenceSource {
  period: ExtractedCertificate["period"];
  payee: ExtractedCertificate["payee"];
  payor: ExtractedCertificate["payor"];
  taxRows: ExtractedCertificate["taxRows"];
  primaryAtcCode: ExtractedCertificate["primaryAtcCode"];
  totals: ExtractedCertificate["totals"];
  signer: Pick<
    ExtractedCertificate["signer"],
    "printedName" | "title" | "tin" | "companyName"
  >;
}

const score = (value: unknown, confidence: number): number =>
  value === null ? 0 : confidence;

export function buildFieldConfidence(
  certificate: FieldConfidenceSource,
  confidence = 0.99,
): ExtractedCertificate["fieldConfidence"] {
  return {
    period: {
      start: score(certificate.period.start, confidence),
      end: score(certificate.period.end, confidence),
      monthOfQuarter: score(certificate.period.monthOfQuarter, confidence),
    },
    payee: {
      name: score(certificate.payee.name, confidence),
      tin: score(certificate.payee.tin, confidence),
      address: score(certificate.payee.address, confidence),
      zip: score(certificate.payee.zip, confidence),
    },
    payor: {
      name: score(certificate.payor.name, confidence),
      tin: score(certificate.payor.tin, confidence),
      address: score(certificate.payor.address, confidence),
      zip: score(certificate.payor.zip, confidence),
    },
    taxRows: certificate.taxRows.map((row) => ({
      lineNumber: row.lineNumber,
      atcCode: score(row.atcCode, confidence),
      description: score(row.description, confidence),
      monthlyAmounts: {
        first: score(row.monthlyAmounts.first, confidence),
        second: score(row.monthlyAmounts.second, confidence),
        third: score(row.monthlyAmounts.third, confidence),
      },
      taxBase: score(row.taxBase, confidence),
      taxRate: score(row.taxRate, confidence),
      taxWithheld: score(row.taxWithheld, confidence),
    })),
    primaryAtcCode: score(certificate.primaryAtcCode, confidence),
    totals: {
      taxBase: score(certificate.totals.taxBase, confidence),
      taxWithheld: score(certificate.totals.taxWithheld, confidence),
    },
    signer: {
      printedName: score(certificate.signer.printedName, confidence),
      title: score(certificate.signer.title, confidence),
      tin: score(certificate.signer.tin, confidence),
      companyName: score(certificate.signer.companyName, confidence),
    },
  };
}

export function withFieldConfidence<T extends FieldConfidenceSource>(
  certificate: T,
  confidence = 0.99,
): T & {
  fieldConfidence: ExtractedCertificate["fieldConfidence"];
  identityFieldVisibility: ExtractedCertificate["identityFieldVisibility"];
} {
  const visibility = (value: unknown) =>
    value === null ? ("blank" as const) : ("readable" as const);
  return {
    ...certificate,
    fieldConfidence: buildFieldConfidence(certificate, confidence),
    identityFieldVisibility: {
      payee: {
        name: visibility(certificate.payee.name),
        tin: visibility(certificate.payee.tin),
      },
      payor: {
        name: visibility(certificate.payor.name),
        tin: visibility(certificate.payor.tin),
      },
    },
  };
}
