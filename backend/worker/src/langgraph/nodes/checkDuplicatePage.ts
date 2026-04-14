import { createHash } from "node:crypto";
import type { WorkflowState, ValidationCheck, ValidationResult } from "../types";

type JsonRecord = Record<string, unknown>;

const DUPLICATE_PAGE_REASON = "duplicate_page_detected";
const MINIMUM_PAGE_TEXT_LENGTH = 80;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getPages(raw: Record<string, unknown>): unknown[] {
  const candidates = [
    raw.pages,
    isRecord(raw.document) ? raw.document.pages : undefined,
    isRecord(raw.data) ? raw.data.pages : undefined,
    isRecord(raw.result) ? raw.result.pages : undefined,
    isRecord(raw.ocr) ? raw.ocr.pages : undefined
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
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
        item.text,
        item.content,
        item.value,
        isRecord(item.line) ? item.line.text : undefined
      ]);
    })
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return text.trim().length > 0 ? text.trim() : undefined;
}

function getPageText(page: unknown): string | undefined {
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
    collectTextFromItems(page.words)
  ]);
}

function normalizePageText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

interface DuplicatePageMatch {
  pageNumber: number;
  duplicateOfPageNumber: number;
}

function findDuplicatePages(raw: Record<string, unknown>): DuplicatePageMatch[] {
  const pages = getPages(raw);
  const fingerprintToPageNumber = new Map<string, number>();
  const duplicates: DuplicatePageMatch[] = [];

  pages.forEach((page, index) => {
    const pageText = getPageText(page);
    if (!pageText) {
      return;
    }

    const normalizedText = normalizePageText(pageText);
    if (normalizedText.length < MINIMUM_PAGE_TEXT_LENGTH) {
      return;
    }

    const fingerprint = createHash("sha256").update(normalizedText).digest("hex");
    const pageNumber =
      isRecord(page) && typeof page.index === "number"
        ? page.index + 1
        : isRecord(page) && typeof page.pageNumber === "number"
          ? page.pageNumber
          : index + 1;
    const existingPageNumber = fingerprintToPageNumber.get(fingerprint);

    if (existingPageNumber) {
      duplicates.push({
        pageNumber,
        duplicateOfPageNumber: existingPageNumber
      });
      return;
    }

    fingerprintToPageNumber.set(fingerprint, pageNumber);
  });

  return duplicates;
}

function buildDuplicateValidation(
  state: WorkflowState,
  duplicates: DuplicatePageMatch[],
): ValidationResult {
  const duplicatePairs = duplicates.map(
    ({ pageNumber, duplicateOfPageNumber }) => `page ${pageNumber} duplicates page ${duplicateOfPageNumber}`,
  );
  const existingChecks = state.validation?.checks ?? [];
  const existingReasons = state.validation?.reasons ?? [];
  const checks: ValidationCheck[] = [
    ...existingChecks,
    {
      code: "DUPLICATE_PAGE_DETECTED",
      passed: false,
      message: `Duplicate pages detected: ${duplicatePairs.join(", ")}`
    }
  ];

  return {
    status: "invalid",
    reasons: [...new Set([...existingReasons, DUPLICATE_PAGE_REASON])],
    checks,
    atcCode: state.validation?.atcCode,
    atcRate: state.validation?.atcRate,
    computedTaxBase: state.validation?.computedTaxBase,
    reportedTaxBase: state.validation?.reportedTaxBase,
    variance: state.validation?.variance,
    threshold: state.validation?.threshold
  };
}

export function createCheckDuplicatePageNode() {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const rawExtraction = state.extraction?.raw;
    if (!rawExtraction) {
      return {
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: state.decision?.reasonCodes ?? [],
          phase: "normalize",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        }
      };
    }

    const duplicates = findDuplicatePages(rawExtraction);
    if (duplicates.length === 0) {
      return {
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: state.decision?.reasonCodes ?? [],
          phase: "normalize",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        }
      };
    }

    const validation = buildDuplicateValidation(state, duplicates);

    return {
      validation,
      decision: {
        terminalStatus: "Duplicate",
        route: "duplicate",
        reasonCodes: [...new Set([...(state.decision?.reasonCodes ?? []), DUPLICATE_PAGE_REASON])],
        phase: "extract",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      }
    };
  };
}
