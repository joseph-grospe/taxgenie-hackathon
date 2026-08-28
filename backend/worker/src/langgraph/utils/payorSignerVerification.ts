import type { Logger } from "@taxgenie/shared";
import type { DocumentExtractionClient } from "../services/documentExtractionClient";
import type { PayorSignerExtractionResult } from "../services/payorSignerContract";
import type {
  EffectiveCertificate,
  SignatureFallbackAudit,
} from "../types";
import { normalizeNullableSourceString } from "./agenticExtraction";
import type { PdfRegionRenderer } from "./pdfRegionRenderer";
import type {
  PdfTextLayerExtractResult,
  PdfTextLayerExtractor,
  PdfTextLayerLine,
} from "./pdfTextLayerExtractor";
import type { SignatureVisualDetectionResult } from "./signatureVisualDetector";

type PayorSignerVerificationAudit = NonNullable<
  SignatureFallbackAudit["payorSignerVerification"]
>;
type SignerIdentityField = PayorSignerVerificationAudit["recoveredFields"][number];

const SIGNER_IDENTITY_FIELDS = [
  "printedName",
  "title",
  "tin",
  "companyName",
] as const satisfies readonly SignerIdentityField[];

const PAYEE_LABEL_PATTERN =
  /\bCONFORME\b|\bPAYEE(?:'S)?\b|signature\s+over\s+printed\s+name\s+of\s+(?:the\s+)?payee/iu;

interface NormalizedBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface VerifiedPayorSignerResult {
  effective: EffectiveCertificate;
  audit: PayorSignerVerificationAudit;
  textLayerRecovery: NonNullable<SignatureFallbackAudit["textLayerRecovery"]>;
}

export interface VerifyPayorSignerInput {
  certificate: EffectiveCertificate;
  pageContent?: Buffer;
  pageNumber?: number;
  detection?: SignatureVisualDetectionResult;
  textLayerExtractor?: PdfTextLayerExtractor;
  regionRenderer?: PdfRegionRenderer;
  extractionClient: DocumentExtractionClient;
  sourceFileId: string;
  revision: string;
  logger: Logger;
}

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeComparableField(
  field: SignerIdentityField,
  value: string,
): string {
  return field === "tin"
    ? value.replace(/\D/gu, "")
    : normalizeComparableText(value);
}

function identityValues(
  certificate: EffectiveCertificate,
): Record<SignerIdentityField, string | null> {
  return {
    printedName: certificate.signer.printedName,
    title: certificate.signer.title,
    tin: certificate.signer.tin,
    companyName: certificate.signer.companyName,
  };
}

function hasIdentityValues(certificate: EffectiveCertificate): boolean {
  const identity = identityValues(certificate);
  return SIGNER_IDENTITY_FIELDS.some((field) => identity[field] !== null);
}

function identitiesDisagree(
  left: Record<SignerIdentityField, string | null>,
  right: Record<SignerIdentityField, string | null>,
): boolean {
  return SIGNER_IDENTITY_FIELDS.some((field) => {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === null || rightValue === null) {
      return leftValue !== rightValue;
    }
    return (
      normalizeComparableField(field, leftValue) !==
      normalizeComparableField(field, rightValue)
    );
  });
}

function canonicalizeCropIdentity(
  result: PayorSignerExtractionResult,
): Record<SignerIdentityField, string | null> {
  const tinSource = normalizeNullableSourceString(result.tin);
  const tinDigits = tinSource?.replace(/\D/gu, "") ?? null;
  return {
    printedName: normalizeNullableSourceString(result.printedName),
    title: normalizeNullableSourceString(result.title),
    tin: tinDigits && tinDigits.length > 0 ? tinDigits : null,
    companyName: normalizeNullableSourceString(result.companyName),
  };
}

function withIdentity(
  certificate: EffectiveCertificate,
  identity: Record<SignerIdentityField, string | null>,
): EffectiveCertificate {
  return {
    ...certificate,
    signer: {
      ...certificate.signer,
      ...identity,
    },
  };
}

function clearIdentity(certificate: EffectiveCertificate): EffectiveCertificate {
  return withIdentity(certificate, {
    printedName: null,
    title: null,
    tin: null,
    companyName: null,
  });
}

function isSafeBounds(
  bounds: NormalizedBounds | undefined,
  pixels:
    | { x: number; y: number; width: number; height: number }
    | undefined,
  pagePixels: { width: number; height: number } | undefined,
): boolean {
  if (!bounds || !pixels || !pagePixels) {
    return false;
  }
  const normalizedValues = [
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
  ];
  return (
    normalizedValues.every(Number.isFinite) &&
    bounds.left >= 0 &&
    bounds.top >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.left + bounds.width <= 1.001 &&
    bounds.top + bounds.height <= 1.001 &&
    [pixels.x, pixels.y, pixels.width, pixels.height].every(Number.isFinite) &&
    pixels.x >= 0 &&
    pixels.y >= 0 &&
    pixels.width > 0 &&
    pixels.height > 0 &&
    pixels.x + pixels.width <= pagePixels.width + 1 &&
    pixels.y + pixels.height <= pagePixels.height + 1
  );
}

function normalizedLineBounds(
  line: PdfTextLayerLine,
  page: NonNullable<PdfTextLayerExtractResult["page"]>,
) {
  return {
    left: line.bounds.left / page.width,
    top: line.bounds.top / page.height,
    right: line.bounds.right / page.width,
    bottom: line.bounds.bottom / page.height,
  };
}

function lineCenterInside(
  line: PdfTextLayerLine,
  page: NonNullable<PdfTextLayerExtractResult["page"]>,
  bounds: NormalizedBounds,
): boolean {
  const normalized = normalizedLineBounds(line, page);
  const centerX = (normalized.left + normalized.right) / 2;
  const centerY = (normalized.top + normalized.bottom) / 2;
  return (
    centerX >= bounds.left &&
    centerX <= bounds.left + bounds.width &&
    centerY >= bounds.top &&
    centerY <= bounds.top + bounds.height
  );
}

function hasPayeeLabelProximity(
  lines: PdfTextLayerLine[],
  page: NonNullable<PdfTextLayerExtractResult["page"]>,
  bounds: NormalizedBounds,
): boolean {
  const horizontalMargin = 0.02;
  const verticalMargin = 0.015;
  return lines.some((line) => {
    if (!PAYEE_LABEL_PATTERN.test(line.text)) {
      return false;
    }
    const normalized = normalizedLineBounds(line, page);
    return (
      normalized.right >= bounds.left - horizontalMargin &&
      normalized.left <= bounds.left + bounds.width + horizontalMargin &&
      normalized.bottom >= bounds.top - verticalMargin &&
      normalized.top <= bounds.top + bounds.height + verticalMargin
    );
  });
}

function confirmIdentityFromLayout(input: {
  certificate: EffectiveCertificate;
  extracted: PdfTextLayerExtractResult;
  bounds: NormalizedBounds;
}):
  | { confirmed: true; fields: SignerIdentityField[] }
  | { confirmed: false } {
  const { page, lines } = input.extracted;
  if (!page || !lines || lines.length === 0) {
    return { confirmed: false };
  }

  const identity = identityValues(input.certificate);
  if (identity.printedName === null) {
    return { confirmed: false };
  }
  const populatedFields = SIGNER_IDENTITY_FIELDS.filter(
    (field) => identity[field] !== null,
  );
  const insideLines = lines.filter((line) =>
    lineCenterInside(line, page, input.bounds),
  );
  if (
    insideLines.length === 0 ||
    hasPayeeLabelProximity(lines, page, input.bounds)
  ) {
    return { confirmed: false };
  }

  const insideText = insideLines.map((line) => line.text).join(" ");
  const allFieldsConfirmed = populatedFields.every((field) => {
    const value = identity[field];
    if (value === null) {
      return true;
    }
    const expected = normalizeComparableField(field, value);
    const actual =
      field === "tin"
        ? insideText.replace(/\D/gu, "")
        : normalizeComparableText(insideText);
    return expected.length > 0 && actual.includes(expected);
  });

  return allFieldsConfirmed
    ? { confirmed: true, fields: [...populatedFields] }
    : { confirmed: false };
}

export async function verifyPayorSigner(
  input: VerifyPayorSignerInput,
): Promise<VerifiedPayorSignerResult> {
  const started = Date.now();
  const baseTextAudit: VerifiedPayorSignerResult["textLayerRecovery"] = {
    status: "not_run",
    recoveredFields: [],
  };
  const window = input.detection?.structure?.payorSignerWindow;
  const pagePixels =
    input.detection?.render?.originalPagePixels ??
    input.detection?.render?.pagePixels;
  if (
    !input.pageContent ||
    input.pageNumber === undefined ||
    !isSafeBounds(window?.normalized, window?.pixels, pagePixels)
  ) {
    return {
      effective: clearIdentity(input.certificate),
      audit: {
        status: "unverifiable",
        pageNumber: input.pageNumber,
        disagreement: hasIdentityValues(input.certificate) || undefined,
        recoveredFields: [],
        latencyMs: Date.now() - started,
        errorCode: "payor_signer_block_unverifiable",
      },
      textLayerRecovery: baseTextAudit,
    };
  }

  let textLayerRecovery = baseTextAudit;
  if (input.textLayerExtractor) {
    try {
      const extracted = await input.textLayerExtractor.extract({
        content: input.pageContent,
        sourceFileId: input.sourceFileId,
        revision: `${input.revision}-payor-signer-text-${input.pageNumber}`,
        pageNumber: input.pageNumber,
      });
      const confirmation = confirmIdentityFromLayout({
        certificate: input.certificate,
        extracted,
        bounds: window!.normalized,
      });
      textLayerRecovery = {
        status: "completed",
        recoveredFields: confirmation.confirmed
          ? confirmation.fields.filter(
              (
                field,
              ): field is Extract<
                SignerIdentityField,
                "printedName" | "title" | "tin"
              > => field !== "companyName",
            )
          : [],
        extractor: extracted.metadata.extractor,
        elapsedMs: extracted.metadata.elapsedMs,
      };
      if (confirmation.confirmed) {
        return {
          effective: input.certificate,
          audit: {
            status: "confirmed",
            source: "text_layout",
            pageNumber: input.pageNumber,
            recoveredFields: confirmation.fields,
            latencyMs: Date.now() - started,
          },
          textLayerRecovery,
        };
      }
    } catch {
      textLayerRecovery = {
        status: "failed",
        recoveredFields: [],
        errorCode: "pdf_text_layer_failed",
      };
    }
  }

  if (!input.regionRenderer || !input.extractionClient.extractPayorSigner) {
    return {
      effective: clearIdentity(input.certificate),
      audit: {
        status: "failed",
        source: "gemini_crop",
        pageNumber: input.pageNumber,
        disagreement: hasIdentityValues(input.certificate) || undefined,
        recoveredFields: [],
        latencyMs: Date.now() - started,
        errorCode: "payor_signer_verification_failed",
      },
      textLayerRecovery,
    };
  }

  try {
    const crop = await input.regionRenderer.render({
      content: input.pageContent,
      sourceFileId: input.sourceFileId,
      revision: `${input.revision}-payor-signer-crop-${input.pageNumber}`,
      pageNumber: input.pageNumber,
      dpi: input.detection!.render!.dpi,
      pagePixels: pagePixels!,
      bounds: window!.pixels,
    });
    const response = await input.extractionClient.extractPayorSigner({
      content: crop.content,
      sourceFileId: input.sourceFileId,
      revision: `${input.revision}-payor-signer-crop-${input.pageNumber}`,
      mimeType: crop.mimeType,
    });
    const identity = canonicalizeCropIdentity(response.result);
    const disagreement = identitiesDisagree(
      identityValues(input.certificate),
      identity,
    );
    const recoveredFields = SIGNER_IDENTITY_FIELDS.filter(
      (field) => identity[field] !== null,
    );
    return {
      effective: withIdentity(input.certificate, identity),
      audit: {
        status:
          identity.printedName === null
            ? "missing"
            : disagreement
              ? "corrected"
              : "confirmed",
        source: "gemini_crop",
        pageNumber: input.pageNumber,
        disagreement: disagreement || undefined,
        recoveredFields,
        latencyMs: Date.now() - started,
      },
      textLayerRecovery,
    };
  } catch {
    input.logger.warn("payor_signer_verification_failed", {
      sourceFileId: input.sourceFileId,
      revision: input.revision,
      pageNumber: input.pageNumber,
    });
    return {
      effective: clearIdentity(input.certificate),
      audit: {
        status: "failed",
        source: "gemini_crop",
        pageNumber: input.pageNumber,
        disagreement: hasIdentityValues(input.certificate) || undefined,
        recoveredFields: [],
        latencyMs: Date.now() - started,
        errorCode: "payor_signer_verification_failed",
      },
      textLayerRecovery,
    };
  }
}
