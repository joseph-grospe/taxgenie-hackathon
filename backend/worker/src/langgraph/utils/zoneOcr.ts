import type { ExtractionPayload } from "../types";
import { getExtractionPlainText, getExtractionText } from "./pageProcessing";

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
  /\b(?:from|period)\s+\d{1,2}\s+\d{1,2}\s+\d{4}.*(?:to)\s+\d{1,2}\s+\d{1,2}\s+\d{4}\b/u;

export const BIR_2307_ZONES: readonly Bir2307ZoneDefinition[] = [
  {
    id: "header_period",
    label: "Header and period covered",
    relativeRect: { left: 0, top: 0, width: 1, height: 0.22 },
  },
  {
    id: "payee_payor_info",
    label: "Payee and payor information",
    relativeRect: { left: 0, top: 0.16, width: 1, height: 0.3 },
  },
  {
    id: "tax_table",
    label: "Tax table",
    relativeRect: { left: 0, top: 0.38, width: 1, height: 0.4 },
  },
  {
    id: "signature_block",
    label: "Signature block",
    relativeRect: { left: 0, top: 0.72, width: 1, height: 0.26 },
  },
];

function hasBir2307Title(normalized: string): boolean {
  return (
    normalized.includes("bir form no 2307") ||
    (normalized.includes("2307") &&
      normalized.includes("certificate") &&
      normalized.includes("withheld"))
  );
}

function hasPeriodCue(normalized: string): boolean {
  return (
    DATE_RANGE_PATTERN.test(normalized) ||
    COMPACT_PERIOD_PATTERN.test(normalized) ||
    (normalized.includes("for the period") &&
      normalized.includes("from") &&
      normalized.includes("to"))
  );
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

function hasLikelySignatoryContent(normalized: string): boolean {
  const hasTitle =
    normalized.includes("manager") ||
    normalized.includes("president") ||
    normalized.includes("treasurer") ||
    normalized.includes("officer") ||
    normalized.includes("finance") ||
    normalized.includes("accountant");
  const hasTin = TIN_PATTERN.test(normalized);
  const hasNameLikeLine =
    /\b[A-Z][A-Z.'-]+\s+[A-Z](?:[A-Z.'-]|\.)*\s+[A-Z][A-Z.'-]+\b/u.test(
      normalized.toUpperCase(),
    );

  return (hasNameLikeLine && hasTitle) || (hasTitle && hasTin);
}

function hasSignatureBlockCue(normalized: string): boolean {
  const hasSignatureLabel = normalized.includes(
    "signature over printed name of payor",
  );

  return hasSignatureLabel && hasLikelySignatoryContent(normalized);
}

function getMissingZones(normalized: string): Bir2307ZoneId[] {
  const missing: Bir2307ZoneId[] = [];

  if (!hasBir2307Title(normalized) || !hasPeriodCue(normalized)) {
    missing.push("header_period");
  }

  if (!hasPayeePayorCue(normalized)) {
    missing.push("payee_payor_info");
  }

  if (!hasTaxTableCue(normalized)) {
    missing.push("tax_table");
  }

  if (!hasSignatureBlockCue(normalized)) {
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
}): ZoneCueResult {
  const normalized = getExtractionText(input.extraction);
  const incompleteMainOcr = normalized.length < 800;
  const weakBir2307Signal = hasWeakBir2307Signal(normalized);
  const canRescueSinglePage =
    input.singlePageRescueEnabled &&
    input.isSinglePage &&
    (incompleteMainOcr || weakBir2307Signal);
  const shouldEvaluate =
    input.likelyCertificate || weakBir2307Signal || canRescueSinglePage;

  if (!shouldEvaluate) {
    return {
      triggeredZones: [],
      skippedZones: [...BIR_2307_ZONE_IDS],
      weakBir2307Signal,
      likelyCertificate: input.likelyCertificate,
      incompleteMainOcr,
    };
  }

  const missingZones = getMissingZones(normalized);
  const cappedZones = missingZones.slice(0, Math.max(0, input.maxZones));

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
  const usableBlocks = blocks.filter((block) => block.text.trim().length > 0);
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
