import { PDFDocument } from "pdf-lib";
import type { ExtractionPayload, PageClassification } from "../types";

const MIN_CERTIFICATE_SCORE = 4;

export interface SplitPdfPage {
  pageNumber: number;
  content: Buffer;
}

type JsonRecord = Record<string, unknown>;

const STRUCTURED_TEXT_ROOT_KEYS = [
  "data",
  "extracted_data",
  "extractedData",
  "document_annotation",
  "documentAnnotation",
  "fields",
] as const;
const STRUCTURED_TEXT_SKIP_KEYS = new Set([
  "base64",
  "bbox",
  "boundingBox",
  "boundingRegions",
  "confidence",
  "dimensions",
  "imageBase64",
  "image_base64",
  "pages",
  "polygon",
  "span",
  "spans",
  "type",
]);
const MAX_STRUCTURED_TEXT_LINES = 200;
const MAX_STRUCTURED_VALUE_LENGTH = 300;

export async function splitPdfPages(source: Buffer): Promise<SplitPdfPage[]> {
  const document = await PDFDocument.load(source);
  const pages: SplitPdfPage[] = [];

  for (let index = 0; index < document.getPageCount(); index += 1) {
    const split = await PDFDocument.create();
    const [page] = await split.copyPages(document, [index]);
    split.addPage(page);
    const bytes = await split.save();
    pages.push({
      pageNumber: index + 1,
      content: Buffer.from(bytes),
    });
  }

  return pages;
}

export function normalizePageText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function isScalarTextValue(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isUsableStructuredTextValue(value: string | number | boolean): boolean {
  if (typeof value === "boolean") {
    return true;
  }

  const text = String(value).trim();
  return (
    text.length > 0 &&
    text.length <= MAX_STRUCTURED_VALUE_LENGTH &&
    !text.startsWith("data:image/")
  );
}

function humanizeStructuredPath(path: string[]): string {
  return path
    .map((part) =>
      part
        .replace(/[_-]+/gu, " ")
        .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
}

function pushStructuredTextLine(
  lines: string[],
  path: string[],
  value: string | number | boolean,
): void {
  if (lines.length >= MAX_STRUCTURED_TEXT_LINES) {
    return;
  }

  if (!isUsableStructuredTextValue(value)) {
    return;
  }

  const label = humanizeStructuredPath(path);
  const text = String(value).trim();
  lines.push(label ? `${label}: ${text}` : text);
}

function collectStructuredTextLines(
  value: unknown,
  path: string[],
  lines: string[],
): void {
  if (lines.length >= MAX_STRUCTURED_TEXT_LINES) {
    return;
  }

  if (isScalarTextValue(value)) {
    pushStructuredTextLine(lines, path, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredTextLines(item, path, lines);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (isScalarTextValue(value.value)) {
    pushStructuredTextLine(lines, path, value.value);
    return;
  }

  if (value.value !== undefined) {
    collectStructuredTextLines(value.value, path, lines);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (STRUCTURED_TEXT_SKIP_KEYS.has(key)) {
      continue;
    }

    collectStructuredTextLines(child, [...path, key], lines);
  }
}

function collectStructuredExtractionText(
  raw: Record<string, unknown>,
): string | undefined {
  const lines: string[] = [];

  for (const key of STRUCTURED_TEXT_ROOT_KEYS) {
    if (raw[key] === undefined) {
      continue;
    }

    collectStructuredTextLines(raw[key], [], lines);
  }

  const text = lines.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function collectTextFromItems(items: unknown): string | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }

  const text = items
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      return firstNonEmptyString([
        item.markdown,
        item.text,
        item.content,
        item.value,
        isRecord(item.line) ? item.line.text : undefined,
      ]);
    })
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return text.trim().length > 0 ? text.trim() : undefined;
}

function getRawExtractionText(
  raw: Record<string, unknown> | undefined,
): string | undefined {
  if (!raw) {
    return undefined;
  }

  const pages = [
    raw.pages,
    isRecord(raw.document) ? raw.document.pages : undefined,
    isRecord(raw.data) ? raw.data.pages : undefined,
    isRecord(raw.result) ? raw.result.pages : undefined,
    isRecord(raw.ocr) ? raw.ocr.pages : undefined,
  ].find(Array.isArray);

  const pageText = Array.isArray(pages)
    ? pages
        .map((page) => {
          if (!isRecord(page)) {
            return undefined;
          }

          return firstNonEmptyString([
            page.markdown,
            page.text,
            page.content,
            page.extractedText,
            page.rawText,
            collectTextFromItems(page.lines),
            collectTextFromItems(page.blocks),
            collectTextFromItems(page.words),
          ]);
        })
        .filter((value): value is string => Boolean(value))
        .join(" ")
    : "";

  return firstNonEmptyString([
    pageText,
    raw.markdown,
    raw.text,
    raw.extractedText,
    raw.content,
    raw.rawText,
    collectTextFromItems(raw.lines),
    collectTextFromItems(raw.blocks),
    collectTextFromItems(raw.words),
    collectStructuredExtractionText(raw),
  ]);
}

function stripZoneOcrFallbackSections(text: string | undefined): string | undefined {
  if (!text?.trim()) {
    return undefined;
  }

  const fallbackIndex = text.search(/\n?\[Zone OCR fallback:/u);
  const mainText = fallbackIndex >= 0 ? text.slice(0, fallbackIndex) : text;
  const trimmed = mainText.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getMainExtractionPlainText(
  extraction: ExtractionPayload | undefined,
): string | undefined {
  return firstNonEmptyString([
    getRawExtractionText(extraction?.raw),
    stripZoneOcrFallbackSections(extraction?.parsedText),
  ]);
}

export function getExtractionPlainText(
  extraction: ExtractionPayload | undefined,
): string | undefined {
  const parsedText = firstNonEmptyString([extraction?.parsedText]);
  const structuredText = extraction?.raw
    ? collectStructuredExtractionText(extraction.raw)
    : undefined;

  if (parsedText && structuredText) {
    return [parsedText, structuredText].join("\n\n");
  }

  return parsedText ?? getRawExtractionText(extraction?.raw);
}

export function getExtractionText(
  extraction: ExtractionPayload | undefined,
): string {
  const extractedText = getExtractionPlainText(extraction);

  return normalizePageText(extractedText ?? "");
}

function hasBirForm2307Label(normalized: string): boolean {
  return normalized.includes("bir form no 2307")
    || (normalized.includes("bir form no") && normalized.includes("2307"));
}

function hasCertificateTitle(normalized: string): boolean {
  return /certificate of creditable(?: tax)? withheld at source/u.test(normalized)
    || (normalized.includes("certificate of creditable") && normalized.includes("withheld at source"));
}

function hasForBirUseOnlyHeader(normalized: string): boolean {
  return normalized.includes("for bir use only")
    || (normalized.includes("for bir") && normalized.includes("use only"));
}

function hasOfficialBirAgencyHeader(normalized: string): boolean {
  return normalized.includes("bureau of internal revenue")
    && (
      normalized.includes("republic of the philippines")
      || normalized.includes("department of finance")
    );
}

export function classifyPageText(rawText: string): PageClassification {
  const normalized = normalizePageText(rawText);
  const hasFormLabel = hasBirForm2307Label(normalized);
  const hasTitle = hasCertificateTitle(normalized);
  const hasUseOnlyHeader = hasForBirUseOnlyHeader(normalized);
  const hasAgencyHeader = hasOfficialBirAgencyHeader(normalized);
  const hasOfficialHeader =
    (hasFormLabel && hasTitle)
    || (hasFormLabel && hasAgencyHeader && hasUseOnlyHeader)
    || (hasTitle && hasAgencyHeader);

  if (hasOfficialHeader) {
    return "certificate";
  }

  const score =
    (hasFormLabel ? 2 : 0)
    + (hasTitle ? 2 : 0)
    + (hasUseOnlyHeader ? 1 : 0)
    + (hasAgencyHeader ? 1 : 0);

  return score >= MIN_CERTIFICATE_SCORE ? "certificate" : "non_certificate";
}
