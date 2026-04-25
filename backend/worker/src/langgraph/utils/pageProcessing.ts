import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type {
  ExtractionPayload,
  PageClassification,
  WorkflowPageState,
} from "../types";

const MIN_CERTIFICATE_SCORE = 4;
const MIN_DUPLICATE_TEXT_LENGTH = 80;

export interface SplitPdfPage {
  pageNumber: number;
  content: Buffer;
}

export interface DuplicatePageMatch {
  pageNumber: number;
  duplicateOfPageNumber: number;
}

type JsonRecord = Record<string, unknown>;

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
  ]);
}

export function getExtractionText(
  extraction: ExtractionPayload | undefined,
): string {
  const extractedText = firstNonEmptyString([
    extraction?.parsedText,
    getRawExtractionText(extraction?.raw),
  ]);

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

export function findDuplicateCertificatePages(
  pages: WorkflowPageState[],
): DuplicatePageMatch[] {
  const fingerprintToPageNumber = new Map<string, number>();
  const duplicates: DuplicatePageMatch[] = [];

  for (const page of pages) {
    if (page.classification !== "certificate") {
      continue;
    }

    const normalizedText = getExtractionText(page.extraction);
    if (normalizedText.length < MIN_DUPLICATE_TEXT_LENGTH) {
      continue;
    }

    const fingerprint = createHash("sha256")
      .update(normalizedText)
      .digest("hex");
    const existing = fingerprintToPageNumber.get(fingerprint);
    if (existing) {
      duplicates.push({
        pageNumber: page.pageNumber,
        duplicateOfPageNumber: existing,
      });
      continue;
    }

    fingerprintToPageNumber.set(fingerprint, page.pageNumber);
  }

  return duplicates;
}
