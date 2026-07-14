import type { ExtractionPayload } from "../types";
import {
  getExtractionPlainText,
  getMainExtractionPlainText,
  normalizePageText,
} from "./pageProcessing";
import type { SignatureVisualDetectionResult } from "./signatureVisualDetector";

export const BIR_2307_ZONE_IDS = [
  "header_period",
  "payee_payor_info",
  "tax_table",
  "signature_block",
] as const;

export type Bir2307ZoneId = (typeof BIR_2307_ZONE_IDS)[number];

export interface Bir2307ZoneDefinition {
  id: Bir2307ZoneId;
  label: string;
  relativeRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface Bir2307ZoneOcrCandidate extends Bir2307ZoneDefinition {
  candidateId?: string;
  candidateSource?: "fixed" | "visual_anchor";
}

export interface ZoneCueResult {
  triggeredZones: Bir2307ZoneId[];
  skippedZones: Bir2307ZoneId[];
  weakBir2307Signal: boolean;
  likelyCertificate: boolean;
  incompleteMainOcr: boolean;
}

const TIN_PATTERN = /\b\d{3}[-\s*]?\d{3}[-\s*]?\d{3}(?:[-\s*]?\d{3,5})?\b/u;
const MONEY_PATTERN = /\b(?:php\s*)?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/u;
const DATE_RANGE_PATTERN =
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*(?:to|-|through)\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/u;
const COMPACT_PERIOD_PATTERN =
  /\b(?:from|period)\s+\d{1,2}\s+\d{1,2}\s+\d{4}.*\bto\b\s+\d{1,2}\s+\d{1,2}\s+\d{4}\b/u;
const SPACED_BOXED_PERIOD_PATTERN =
  /\bfor\s+the\s+period\b.{0,120}\bfrom\b(?:\D*\d){8}.{0,80}\bto\b(?:\D*\d){8}/u;
const MAX_REASONABLE_PERIOD_DAYS = 120;
const MAX_REASONABLE_PERIOD_FUTURE_YEARS = 1;
const SIGNER_TIN_PATTERN =
  /\b\d{3}[-\s*]?\d{3}[-\s*]?\d{3}(?:[-\s*]?\d{3,5})?\b/u;
const SIGNER_TITLE_PATTERN =
  /\b(?:finance\s+manager|general\s+manager|manager|president|treasurer|controller|accountant|officer|authorized\s+representative|tax\s+agent|chief\s+financial\s+officer|cfo)\b/iu;
const SIGNER_NAME_PATTERN =
  /\b[A-Z][A-Z.'-]{1,}(?:\s+[A-Z](?:\.|[A-Z.'-]{1,})?){1,5}(?:,?\s+(?:JR|SR|III|IV)\.?)?\b/u;
const SIGNER_LINE_EXCLUSION_PATTERN =
  /\b(?:bureau|department|certificate|withheld|taxpayer|signature\s+over|payor|payee|representative|tax\s+agent|address|corporation|cooperative|electric|company|corp|inc|panelco|registered|government|privacy|website|amount|period|income|payment|declare|perjury)\b/iu;

const SIGNATURE_BLOCK_ZONE: Bir2307ZoneDefinition = {
  id: "signature_block",
  label: "Payor signature text",
  relativeRect: { left: 0, top: 0.88, width: 0.5, height: 0.1 },
};

export const BIR_2307_ZONES: readonly Bir2307ZoneDefinition[] = [
  {
    id: "header_period",
    label: "Header and period covered",
    relativeRect: { left: 0, top: 0, width: 1, height: 0.22 },
  },
  {
    id: "payee_payor_info",
    label: "Payee and payor information",
    relativeRect: { left: 0, top: 0.12, width: 1, height: 0.34 },
  },
  {
    id: "tax_table",
    label: "Tax table",
    relativeRect: { left: 0, top: 0.38, width: 1, height: 0.4 },
  },
  SIGNATURE_BLOCK_ZONE,
];

const BIR_2307_SIGNATURE_ZONE_CANDIDATES: readonly Bir2307ZoneOcrCandidate[] = [
  {
    ...SIGNATURE_BLOCK_ZONE,
    candidateId: "payor_left_lower",
    candidateSource: "fixed",
  },
  {
    id: "signature_block",
    label: "Payor signature text upper band",
    candidateId: "payor_left_upper",
    candidateSource: "fixed",
    relativeRect: { left: 0, top: 0.82, width: 0.58, height: 0.12 },
  },
  {
    id: "signature_block",
    label: "Payor signature text wide band",
    candidateId: "payor_wide_lower",
    candidateSource: "fixed",
    relativeRect: { left: 0, top: 0.86, width: 0.75, height: 0.12 },
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRelativeRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Bir2307ZoneDefinition["relativeRect"] {
  const left = clamp(rect.left, 0, 0.99);
  const top = clamp(rect.top, 0, 0.99);
  const right = clamp(rect.left + rect.width, left + 0.01, 1);
  const bottom = clamp(rect.top + rect.height, top + 0.01, 1);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function buildVisualAnchorSignatureCandidates(
  detection: SignatureVisualDetectionResult | undefined,
): readonly Bir2307ZoneOcrCandidate[] | undefined {
  const hasDetectedSignature =
    detection?.signaturePresent === true && detection.status === "detected";
  const hasVisibleSignerBand =
    detection?.anchorOcrEligible === true &&
    detection.structure?.payorSignerBandVisible === true;
  if (!hasDetectedSignature && !hasVisibleSignerBand) {
    return undefined;
  }

  const pageWidth = detection.render.pagePixels.width;
  const pageHeight = detection.render.pagePixels.height;
  const crop = detection.render.cropPixels;
  if (
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    return undefined;
  }

  const anchor = {
    left: crop.x / pageWidth,
    top: crop.y / pageHeight,
    width: crop.width / pageWidth,
    height: crop.height / pageHeight,
  };
  const expanded = normalizeRelativeRect({
    left: anchor.left - 0.035,
    top: anchor.top - Math.max(0.012, anchor.height * 0.08),
    width: anchor.width + 0.07,
    height: Math.min(anchor.height * 1.08, 0.32),
  });
  const upperBand = normalizeRelativeRect({
    left: expanded.left,
    top: expanded.top,
    width: expanded.width,
    height: expanded.height * 0.68,
  });

  return [
    {
      id: "signature_block",
      label: "Payor signature text visual anchor",
      candidateId: "visual_anchor_payor_region",
      candidateSource: "visual_anchor",
      relativeRect: expanded,
    },
    {
      id: "signature_block",
      label: "Payor signature text visual anchor upper band",
      candidateId: "visual_anchor_payor_upper_band",
      candidateSource: "visual_anchor",
      relativeRect: upperBand,
    },
    {
      id: "signature_block",
      label: "Payor signature text upper band",
      candidateId: "payor_left_upper",
      candidateSource: "fixed",
      relativeRect: { left: 0, top: 0.82, width: 0.58, height: 0.12 },
    },
  ];
}

export function getBir2307ZoneOcrCandidates(
  zone: Bir2307ZoneDefinition,
  options: {
    signatureVisualDetection?: SignatureVisualDetectionResult;
  } = {},
): readonly Bir2307ZoneOcrCandidate[] {
  if (zone.id === "signature_block") {
    const visualAnchorCandidates = buildVisualAnchorSignatureCandidates(
      options.signatureVisualDetection,
    );
    if (visualAnchorCandidates) {
      return visualAnchorCandidates;
    }

    return BIR_2307_SIGNATURE_ZONE_CANDIDATES;
  }

  return [{ ...zone, candidateSource: "fixed" }];
}

function hasBir2307Title(normalized: string): boolean {
  return (
    normalized.includes("bir form no 2307") ||
    (normalized.includes("2307") &&
      normalized.includes("certificate") &&
      normalized.includes("withheld"))
  );
}

function getFirstMmddyyyyDigits(fragment: string): string | undefined {
  const tokens = fragment.match(/\d+/gu) ?? [];
  let digits = "";

  for (const token of tokens) {
    digits += token;
    if (digits.length === 8) {
      return digits;
    }
    if (digits.length > 8) {
      return undefined;
    }
  }

  return undefined;
}

function toPeriodDateFromMmddyyyyFragment(fragment: string): Date | undefined {
  const rawDigits = getFirstMmddyyyyDigits(fragment);
  if (!rawDigits) {
    return undefined;
  }
  const month = Number(rawDigits.slice(0, 2));
  const day = Number(rawDigits.slice(2, 4));
  const year = Number(rawDigits.slice(4, 8));
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 2018 ||
    year > new Date().getUTCFullYear() + MAX_REASONABLE_PERIOD_FUTURE_YEARS
  ) {
    return undefined;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }

  return parsed;
}

function hasPlausiblePeriodRange(start: Date, end: Date): boolean {
  const durationDays =
    (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);

  return durationDays >= 0 && durationDays <= MAX_REASONABLE_PERIOD_DAYS;
}

function extractPlausiblePeriodCue(normalized: string): boolean {
  const match =
    /\bfor\s+the\s+period\b[\s\S]{0,80}?\bfrom\b(?<start>[\s\S]{1,80}?)\bto\b(?<end>[\s\S]{1,80})/iu.exec(
      normalized,
    );
  if (!match?.groups) {
    return false;
  }

  const start = toPeriodDateFromMmddyyyyFragment(match.groups.start);
  const end = toPeriodDateFromMmddyyyyFragment(match.groups.end);

  return Boolean(start && end && hasPlausiblePeriodRange(start, end));
}

function hasPeriodCue(normalized: string): boolean {
  if (
    !DATE_RANGE_PATTERN.test(normalized) &&
    !COMPACT_PERIOD_PATTERN.test(normalized) &&
    !SPACED_BOXED_PERIOD_PATTERN.test(normalized)
  ) {
    return false;
  }

  return extractPlausiblePeriodCue(normalized);
}

function hasPayeePayorCue(normalized: string): boolean {
  const hasSections =
    normalized.includes("payee") &&
    normalized.includes("payor") &&
    (normalized.includes("taxpayer identification") ||
      normalized.includes("tin"));
  const tinMatches =
    normalized.match(new RegExp(TIN_PATTERN.source, "gu")) ?? [];

  return hasSections && tinMatches.length >= 2;
}

function hasTaxTableCue(normalized: string): boolean {
  const hasAtc =
    /\bwc\d{3}\b/u.test(normalized) || normalized.includes(" atc ");
  const hasTaxWords =
    normalized.includes("tax withheld") ||
    normalized.includes("income payments") ||
    normalized.includes("amount of income payments");

  return hasAtc && hasTaxWords && MONEY_PATTERN.test(normalized);
}

function getPayorSignatureCueText(ocrText: string): string | undefined {
  const payorSignatureText = getPayorSignatureEvidenceText(ocrText);
  const lines = payorSignatureText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const labelIndex = lines.findIndex((line) => hasPayorSignatureLabel(line));
  if (labelIndex < 0) {
    return undefined;
  }

  const startIndex = Math.max(0, labelIndex - 3);
  return lines.slice(startIndex, labelIndex + 1).join("\n");
}

function hasSignatureBlockCue(ocrText: string): boolean {
  const cueText = getPayorSignatureCueText(ocrText);
  return Boolean(
    cueText && hasLikelySignerLine(cueText, { allowNameOnly: true }),
  );
}

function getMissingZones(input: {
  normalized: string;
  ocrText: string;
}): Bir2307ZoneId[] {
  const missing: Bir2307ZoneId[] = [];

  if (!hasBir2307Title(input.normalized) || !hasPeriodCue(input.normalized)) {
    missing.push("header_period");
  }

  if (!hasPayeePayorCue(input.normalized)) {
    missing.push("payee_payor_info");
  }

  if (!hasTaxTableCue(input.normalized)) {
    missing.push("tax_table");
  }

  if (!hasSignatureBlockCue(input.ocrText)) {
    missing.push("signature_block");
  }

  return missing;
}

export function hasWeakBir2307Signal(normalized: string): boolean {
  const signals = [
    normalized.includes("bir"),
    normalized.includes("2307"),
    normalized.includes("certificate"),
    normalized.includes("withheld"),
    normalized.includes("payee"),
    normalized.includes("payor"),
    normalized.includes("taxpayer identification"),
    normalized.includes(" atc ") || /\bwc\d{3}\b/u.test(normalized),
  ];

  return signals.filter(Boolean).length >= 2;
}

export function assessZoneOcrNeeds(input: {
  extraction: ExtractionPayload;
  likelyCertificate: boolean;
  isSinglePage: boolean;
  singlePageRescueEnabled: boolean;
  maxZones: number;
  forcedZones?: Bir2307ZoneId[];
}): ZoneCueResult {
  const mainOcrText = getMainExtractionPlainText(input.extraction) ?? "";
  const normalized = normalizePageText(mainOcrText);
  const incompleteMainOcr = normalized.length < 800;
  const weakBir2307Signal = hasWeakBir2307Signal(normalized);
  const forcedZones =
    input.forcedZones?.filter(
      (zoneId, index, zones) =>
        BIR_2307_ZONE_IDS.includes(zoneId) && zones.indexOf(zoneId) === index,
    ) ?? [];
  const canRescueSinglePage =
    input.singlePageRescueEnabled &&
    input.isSinglePage &&
    (incompleteMainOcr || weakBir2307Signal);
  const shouldEvaluate =
    forcedZones.length > 0 ||
    input.likelyCertificate ||
    weakBir2307Signal ||
    canRescueSinglePage;

  if (!shouldEvaluate) {
    return {
      triggeredZones: [],
      skippedZones: [...BIR_2307_ZONE_IDS],
      weakBir2307Signal,
      likelyCertificate: input.likelyCertificate,
      incompleteMainOcr,
    };
  }

  const missingZones = getMissingZones({
    normalized,
    ocrText: mainOcrText,
  });
  const prioritizedZones = [
    ...forcedZones,
    ...missingZones.filter((zoneId) => !forcedZones.includes(zoneId)),
  ];
  const cappedZones = prioritizedZones.slice(0, Math.max(0, input.maxZones));

  return {
    triggeredZones: cappedZones,
    skippedZones: BIR_2307_ZONE_IDS.filter(
      (zone) => !cappedZones.includes(zone),
    ),
    weakBir2307Signal,
    likelyCertificate: input.likelyCertificate,
    incompleteMainOcr,
  };
}

export function appendZoneOcrText(
  extraction: ExtractionPayload,
  blocks: Array<{ zoneId: Bir2307ZoneId; text: string; markdown?: string }>,
): ExtractionPayload {
  const usableBlocks = blocks.filter(
    (block) => !getZoneOcrBlockDiscardReason(block),
  );
  if (usableBlocks.length === 0) {
    return extraction;
  }

  const appendedText = usableBlocks
    .map(
      (block) => `[Zone OCR fallback: ${block.zoneId}]\n${block.text.trim()}`,
    )
    .join("\n\n");
  const parsedText = [getExtractionPlainText(extraction)?.trim(), appendedText]
    .filter((value): value is string => Boolean(value && value.length > 0))
    .join("\n\n");

  return {
    ...extraction,
    parsedText,
    raw: {
      ...extraction.raw,
      zoneOcrFallbackText: usableBlocks,
    },
  };
}

function getPayorSignatureEvidenceText(text: string): string {
  const normalizedLineBreaks = text.replace(/\\n/gu, "\n");
  const conformeIndex = normalizedLineBreaks.search(/\bconforme\s*:/iu);
  return conformeIndex >= 0
    ? normalizedLineBreaks.slice(0, conformeIndex)
    : normalizedLineBreaks;
}

function normalizeEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasPayorSignatureLabel(text: string): boolean {
  const normalized = normalizeEvidenceText(text);
  return (
    normalized.includes("signature over printed name of payor") ||
    normalized.includes("payor s authorized representative") ||
    normalized.includes("payor authorized representative")
  );
}

function hasLikelySignerLine(
  text: string,
  options: { allowNameOnly?: boolean } = {},
): boolean {
  return text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\|/gu, " ").replace(/\s+/gu, " ").trim())
    .some((line) => {
      const normalizedLine = line.toUpperCase();
      if (!SIGNER_TITLE_PATTERN.test(line)) {
        return (
          options.allowNameOnly === true &&
          !SIGNER_LINE_EXCLUSION_PATTERN.test(line) &&
          SIGNER_NAME_PATTERN.test(normalizedLine)
        );
      }

      if (SIGNER_TIN_PATTERN.test(line)) {
        return true;
      }

      const titleMatch = SIGNER_TITLE_PATTERN.exec(line);
      const beforeTitle = titleMatch
        ? line.slice(0, titleMatch.index).trim()
        : line;
      if (
        beforeTitle.length === 0 ||
        SIGNER_LINE_EXCLUSION_PATTERN.test(beforeTitle)
      ) {
        return false;
      }

      return SIGNER_NAME_PATTERN.test(beforeTitle.toUpperCase());
    });
}

export function getZoneOcrBlockDiscardReason(block: {
  zoneId: Bir2307ZoneId;
  text: string;
  markdown?: string;
}): string | undefined {
  const content = [block.markdown, block.text]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .trim();

  if (!content) {
    return "empty_text";
  }

  if (block.zoneId !== "signature_block") {
    return undefined;
  }

  const payorSignatureText = getPayorSignatureEvidenceText(content);
  if (
    hasPayorSignatureLabel(payorSignatureText) ||
    hasLikelySignerLine(payorSignatureText)
  ) {
    return undefined;
  }

  return "signature_low_signal";
}
