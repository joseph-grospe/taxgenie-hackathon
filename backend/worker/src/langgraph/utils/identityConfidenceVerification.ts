import type { Logger } from "@taxgenie/shared";
import { PDFDocument } from "pdf-lib";
import type { DocumentExtractionClient } from "../services/documentExtractionClient";
import type {
  EffectiveCertificate,
  IdentityField,
  IdentityFieldCropAudit,
  IdentityFieldDecisionAudit,
  IdentityFieldVisibility,
  IdentityParty,
} from "../types";
import { splitPdfPages } from "./pageProcessing";
import type { PdfRegionRenderer } from "./pdfRegionRenderer";

export const IDENTITY_REREAD_MIN_CONFIDENCE = 0.8;
export const IDENTITY_ACCEPT_CONFIDENCE = 0.95;

interface CropPreset extends IdentityFieldCropAudit {}

const TIN_CROPS: Record<IdentityParty, CropPreset[]> = {
  payee: [
    {
      preset: "tight_v1",
      dpi: 300,
      normalizedBounds: { left: 0.25, top: 0.145, width: 0.55, height: 0.08 },
    },
    {
      preset: "expanded_v1",
      dpi: 400,
      normalizedBounds: { left: 0.18, top: 0.13, width: 0.68, height: 0.11 },
    },
  ],
  payor: [
    {
      preset: "tight_v1",
      dpi: 300,
      normalizedBounds: { left: 0.25, top: 0.275, width: 0.55, height: 0.065 },
    },
    {
      preset: "expanded_v1",
      dpi: 400,
      normalizedBounds: { left: 0.18, top: 0.255, width: 0.68, height: 0.11 },
    },
  ],
};

const NAME_CROPS: Record<IdentityParty, CropPreset[]> = {
  payee: [
    {
      preset: "name_row_v1",
      dpi: 400,
      normalizedBounds: { left: 0.08, top: 0.17, width: 0.86, height: 0.075 },
    },
  ],
  payor: [
    {
      preset: "name_row_v1",
      dpi: 400,
      normalizedBounds: { left: 0.08, top: 0.305, width: 0.86, height: 0.075 },
    },
  ],
};

const FIELDS: Array<{ party: IdentityParty; field: IdentityField }> = [
  { party: "payee", field: "name" },
  { party: "payee", field: "tin" },
  { party: "payor", field: "name" },
  { party: "payor", field: "tin" },
];

function canonicalizeValue(
  field: IdentityField,
  value: string | null | undefined,
): string | null {
  if (field === "tin") {
    const digits = value?.replace(/\D/gu, "") ?? "";
    return digits.length > 0 ? digits : null;
  }
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function fieldValue(
  certificate: EffectiveCertificate,
  party: IdentityParty,
  field: IdentityField,
): string | null {
  return certificate[party][field];
}

function fieldConfidence(
  certificate: EffectiveCertificate,
  party: IdentityParty,
  field: IdentityField,
): number {
  return certificate.fieldConfidence[party][field];
}

function fieldVisibility(
  certificate: EffectiveCertificate,
  party: IdentityParty,
  field: IdentityField,
): IdentityFieldVisibility {
  return certificate.identityFieldVisibility[party][field];
}

function referenceFor(party: IdentityParty) {
  return party === "payee"
    ? ("selected_entity" as const)
    : ("masterlist" as const);
}

function baseDecision(input: {
  certificate: EffectiveCertificate;
  party: IdentityParty;
  field: IdentityField;
}): Pick<
  IdentityFieldDecisionAudit,
  | "party"
  | "field"
  | "fieldPath"
  | "initialValue"
  | "initialConfidence"
  | "initialVisibility"
  | "effectiveValue"
  | "effectiveConfidence"
  | "effectiveVisibility"
  | "reference"
  | "crops"
> {
  const value = fieldValue(input.certificate, input.party, input.field);
  const confidence = fieldConfidence(
    input.certificate,
    input.party,
    input.field,
  );
  const visibility = fieldVisibility(
    input.certificate,
    input.party,
    input.field,
  );
  return {
    party: input.party,
    field: input.field,
    fieldPath: `${input.party}.${input.field}`,
    initialValue: value,
    initialConfidence: confidence,
    initialVisibility: visibility,
    effectiveValue: value,
    effectiveConfidence: confidence,
    effectiveVisibility: visibility,
    reference: referenceFor(input.party),
    crops: [],
  };
}

interface PreparedPage {
  content: Buffer;
  pageNumber: number;
  widthPoints: number;
  heightPoints: number;
}

async function prepareIdentityPage(input: {
  certificatePdf?: Buffer;
  pageNumbers: number[];
}): Promise<PreparedPage | null> {
  if (!input.certificatePdf || input.pageNumbers.length === 0) {
    return null;
  }
  const pageNumber = Math.min(...input.pageNumbers);
  const pages = await splitPdfPages(input.certificatePdf);
  const artifactIndex = input.pageNumbers.indexOf(pageNumber);
  const page = pages[artifactIndex >= 0 ? artifactIndex : 0];
  if (!page) {
    return null;
  }
  const document = await PDFDocument.load(page.content, {
    ignoreEncryption: true,
  });
  const size = document.getPage(0).getSize();
  return {
    content: page.content,
    pageNumber,
    widthPoints: size.width,
    heightPoints: size.height,
  };
}

function unresolvedDecision(
  base: ReturnType<typeof baseDecision>,
  input: {
    reason:
      | "first_confidence_below_reread_minimum"
      | "first_field_unreadable"
      | "reread_confidence_below_acceptance"
      | "reread_failed";
    pageNumber?: number;
    crops?: CropPreset[];
    rereadValue?: string | null;
    rereadConfidence?: number;
    rereadVisibility?: IdentityFieldVisibility;
    errorCode?: string;
  },
): IdentityFieldDecisionAudit {
  return {
    ...base,
    status: "manual_review",
    decisionReason: input.reason,
    pageNumber: input.pageNumber,
    crops: input.crops ?? [],
    rereadValue: input.rereadValue,
    rereadConfidence: input.rereadConfidence,
    rereadVisibility: input.rereadVisibility,
    errorCode: input.errorCode,
  };
}

export async function resolveIdentityFieldConfidence(input: {
  certificate: EffectiveCertificate;
  certificatePdf?: Buffer;
  extractionClient?: DocumentExtractionClient;
  regionRenderer?: PdfRegionRenderer;
  sourceFileId: string;
  revision: string;
  logger: Logger;
}): Promise<{
  effective: EffectiveCertificate;
  decisions: IdentityFieldDecisionAudit[];
}> {
  let preparedPage: PreparedPage | null = null;
  const needsFocusedReread = FIELDS.some(({ party, field }) => {
    const confidence = fieldConfidence(input.certificate, party, field);
    return (
      fieldVisibility(input.certificate, party, field) === "readable" &&
      confidence >= IDENTITY_REREAD_MIN_CONFIDENCE &&
      confidence < IDENTITY_ACCEPT_CONFIDENCE
    );
  });
  if (needsFocusedReread) {
    try {
      preparedPage = await prepareIdentityPage({
        certificatePdf: input.certificatePdf,
        pageNumbers: input.certificate.pageNumbers,
      });
    } catch {
      preparedPage = null;
    }
  }

  const decisions = await Promise.all(
    FIELDS.map(
      async ({ party, field }): Promise<IdentityFieldDecisionAudit> => {
        const base = baseDecision({
          certificate: input.certificate,
          party,
          field,
        });
        if (base.initialVisibility === "blank") {
          return {
            ...base,
            status: "confirmed_blank",
            decisionReason: "first_read_blank",
          };
        }
        if (base.initialVisibility === "unreadable") {
          return unresolvedDecision(base, {
            reason: "first_field_unreadable",
          });
        }
        if (base.initialConfidence >= IDENTITY_ACCEPT_CONFIDENCE) {
          return {
            ...base,
            status: "accepted_first_read",
            decisionReason: "first_confidence_accepted",
          };
        }
        if (base.initialConfidence < IDENTITY_REREAD_MIN_CONFIDENCE) {
          return unresolvedDecision(base, {
            reason: "first_confidence_below_reread_minimum",
          });
        }

        const crops = field === "tin" ? TIN_CROPS[party] : NAME_CROPS[party];
        if (
          !preparedPage ||
          !input.regionRenderer ||
          !input.extractionClient?.extractIdentityField
        ) {
          return unresolvedDecision(base, {
            reason: "reread_failed",
            crops,
            pageNumber: preparedPage?.pageNumber,
            errorCode: !preparedPage
              ? "certificate_page_unavailable"
              : !input.regionRenderer
                ? "identity_renderer_unavailable"
                : "identity_reread_unavailable",
          });
        }

        try {
          const images = await Promise.all(
            crops.map(async (crop) => {
              const pagePixels = {
                width: Math.ceil((preparedPage!.widthPoints * crop.dpi) / 72),
                height: Math.ceil((preparedPage!.heightPoints * crop.dpi) / 72),
              };
              const bounds = {
                x: crop.normalizedBounds.left * pagePixels.width,
                y: crop.normalizedBounds.top * pagePixels.height,
                width: crop.normalizedBounds.width * pagePixels.width,
                height: crop.normalizedBounds.height * pagePixels.height,
              };
              const rendered = await input.regionRenderer!.render({
                content: preparedPage!.content,
                sourceFileId: input.sourceFileId,
                revision: `${input.revision}-${party}-${field}-${crop.preset}`,
                pageNumber: preparedPage!.pageNumber,
                dpi: crop.dpi,
                pagePixels,
                bounds,
              });
              return { mimeType: rendered.mimeType, content: rendered.content };
            }),
          );
          const response = await input.extractionClient.extractIdentityField({
            sourceFileId: input.sourceFileId,
            revision: `${input.revision}-${party}-${field}`,
            party,
            field,
            images,
          });
          const value = canonicalizeValue(field, response.result.value);
          const confidence = response.result.confidence;
          const visibility = response.result.visibility;
          if (visibility === "blank") {
            return {
              ...base,
              status: "confirmed_blank",
              decisionReason: "reread_blank",
              pageNumber: preparedPage.pageNumber,
              crops,
              rereadValue: null,
              rereadConfidence: 0,
              rereadVisibility: "blank",
              effectiveValue: null,
              effectiveConfidence: 0,
              effectiveVisibility: "blank",
              metadata: response.metadata,
            };
          }
          if (visibility === "unreadable") {
            return {
              ...unresolvedDecision(base, {
                reason: "reread_confidence_below_acceptance",
                crops,
                pageNumber: preparedPage.pageNumber,
                rereadValue: null,
                rereadConfidence: 0,
                rereadVisibility: "unreadable",
              }),
              metadata: response.metadata,
            };
          }
          if (confidence < IDENTITY_ACCEPT_CONFIDENCE) {
            return {
              ...unresolvedDecision(base, {
                reason: "reread_confidence_below_acceptance",
                crops,
                pageNumber: preparedPage.pageNumber,
                rereadValue: value,
                rereadConfidence: confidence,
                rereadVisibility: visibility,
              }),
              metadata: response.metadata,
            };
          }
          return {
            ...base,
            status:
              value === base.initialValue
                ? "reread_confirmed"
                : "reread_corrected",
            decisionReason: "reread_confidence_accepted",
            pageNumber: preparedPage.pageNumber,
            crops,
            rereadValue: value,
            rereadConfidence: confidence,
            rereadVisibility: visibility,
            effectiveValue: value,
            effectiveConfidence: confidence,
            effectiveVisibility: visibility,
            metadata: response.metadata,
          };
        } catch (error) {
          input.logger.warn("identity_field_reread_failed", {
            sourceFileId: input.sourceFileId,
            revision: input.revision,
            party,
            field,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return unresolvedDecision(base, {
            reason: "reread_failed",
            crops,
            pageNumber: preparedPage.pageNumber,
            errorCode: "identity_reread_failed",
          });
        }
      },
    ),
  );

  let effective = input.certificate;
  for (const decision of decisions) {
    if (
      decision.status !== "reread_confirmed" &&
      decision.status !== "reread_corrected" &&
      !(
        decision.status === "confirmed_blank" &&
        decision.decisionReason === "reread_blank"
      )
    ) {
      continue;
    }
    effective = {
      ...effective,
      [decision.party]: {
        ...effective[decision.party],
        [decision.field]: decision.effectiveValue,
      },
      fieldConfidence: {
        ...effective.fieldConfidence,
        [decision.party]: {
          ...effective.fieldConfidence[decision.party],
          [decision.field]: decision.effectiveConfidence,
        },
      },
      identityFieldVisibility: {
        ...effective.identityFieldVisibility,
        [decision.party]: {
          ...effective.identityFieldVisibility[decision.party],
          [decision.field]: decision.effectiveVisibility,
        },
      },
    };
  }

  return { effective, decisions };
}
