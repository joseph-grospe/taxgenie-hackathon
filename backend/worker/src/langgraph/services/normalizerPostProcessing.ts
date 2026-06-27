import { normalizeTinDigits } from "@taxtrack/shared";
import type { ExtractionPayload, NormalizedFields } from "../types";
import {
  buildPeriodCoveredValue,
  extractPeriodEndDate,
  extractPeriodStartDate,
  normalizePeriodCoveredValue,
  normalizePeriodEndValue,
  normalizePeriodStartValue,
  parseMoney,
} from "../utils/parsing";
import { getMainExtractionPlainText } from "../utils/pageProcessing";

export interface NormalizedResult {
  fields: NormalizedFields;
}

export interface NormalizerAuditInput {
  sourceFileId: string;
  revision: string;
  startedAt: string;
  elapsedMs: number;
  provider: string;
  model: string;
  responseModel?: string;
  requestPayloadChars: number;
  annotationPayloadChars: number;
  usageInfo?: unknown;
}

export interface NormalizerPostProcessInput {
  normalized: Record<string, unknown>;
  extraction: ExtractionPayload;
  annotationRaw?: Record<string, unknown>;
  signatureVisualDetection?: SignatureVisualSignerRecoveryEvidence;
  audit: NormalizerAuditInput;
}

interface SignatureVisualSignerRecoveryEvidence {
  status?: string;
  signaturePresent?: boolean;
  anchorOcrEligible?: boolean;
  structure?: {
    payorSignerBandVisible?: boolean;
  };
}

export const NORMALIZER_PROMPT_SCHEMA_VERSION = 8;
export const NORMALIZER_RESPONSE_SCHEMA_NAME = "bir2307_normalized_fields";
export const NORMALIZER_RESPONSE_SCHEMA_VERSION = 1;
export const SIGNATURE_BLOCK_RESPONSE_SCHEMA_NAME =
  "bir2307_signature_block_fields";
export const SIGNATURE_BLOCK_RESPONSE_SCHEMA_VERSION = 1;

const MONTH_OF_QUARTER_VALUES = ["first", "second", "third"] as const;
type MonthOfQuarter = (typeof MONTH_OF_QUARTER_VALUES)[number];
type MonthOfQuarterInference =
  | { kind: "month"; value: MonthOfQuarter }
  | { kind: "clear" }
  | { kind: "unknown" };
interface RecoveredSignerFields {
  printedName: string;
  signatoryTitle?: string;
  signatoryTin?: string;
  label: "payor" | "payee_mislabeled";
  sourceLine: string;
}
interface SignerTextFallbackResult {
  fields?: RecoveredSignerFields;
  audit: {
    status: "recovered" | "not_found";
    reason?: string;
    source: "ocr_pre_conforme";
    label?: RecoveredSignerFields["label"];
    recoveredFields?: string[];
    sourceLine?: string;
    visualStatus?: string;
    visualReason?: "detected_signature" | "visible_signer_band";
  };
}
const ATC_CODE_PATTERN = /\b([A-Z]{2})\s*-?\s*(\d{3})\b/iu;
const CANONICAL_TIN_LENGTHS = new Set([9, 12, 13, 14]);
const SIGNER_FIELD_LOW_CONFIDENCE_THRESHOLD = 0.2;
const MIN_REASONABLE_BIR2307_PERIOD_YEAR = 2018;
const MAX_REASONABLE_BIR2307_PERIOD_DAYS = 120;
const MAX_REASONABLE_BIR2307_FUTURE_YEARS = 1;
const NORMALIZER_CONFIDENCE_FIELDS = [
  "isBir2307",
  "periodStart",
  "periodCovered",
  "periodEnd",
  "monthOfQuarter",
  "payeeName",
  "payeeTin",
  "payeeAddress",
  "payeeZip",
  "payorName",
  "payorTin",
  "payorAddress",
  "payorZip",
  "atcCode",
  "taxBase",
  "taxWithheld",
  "printedName",
  "signatoryTitle",
  "signatoryTin",
  "signaturePresent",
  "signatureText",
  "companyName",
] as const;
const NORMALIZER_RESPONSE_FIELDS = [
  ...NORMALIZER_CONFIDENCE_FIELDS,
  "confidences",
  "warnings",
] as const;
const SIGNATURE_BLOCK_CONFIDENCE_FIELDS = [
  "printedName",
  "signatoryTitle",
  "signatoryTin",
  "signaturePresent",
  "signatureText",
] as const;
const SIGNATURE_BLOCK_RESPONSE_FIELDS = [
  ...SIGNATURE_BLOCK_CONFIDENCE_FIELDS,
  "confidences",
  "warnings",
] as const;

function nullableJsonSchemaType(type: "string" | "number" | "boolean") {
  return { type: [type, "null"] };
}

export const BIR2307_DOCUMENT_ANNOTATION_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: NORMALIZER_RESPONSE_SCHEMA_NAME,
    strict: true,
    schema: {
      type: "object",
      properties: {
        periodStart: {
          ...nullableJsonSchemaType("string"),
          description:
            "Starting date from item 1 For the Period From. Normalize to MM-DD-YYYY, including spaced boxed digits such as 0 7 2 6 2 0 2 5 -> 07-26-2025. Null if not visible.",
        },
        isBir2307: {
          ...nullableJsonSchemaType("boolean"),
          description:
            "True if the document is a BIR Form 2307 certificate. False if it is clearly another document type. Null if uncertain.",
        },
        periodCovered: {
          ...nullableJsonSchemaType("string"),
          description:
            "Period covered date range from item 1 For the Period From/To. Normalize to MM-DD-YYYY to MM-DD-YYYY, including spaced boxed digits. Null if either date is not visible.",
        },
        periodEnd: {
          ...nullableJsonSchemaType("string"),
          description:
            "Ending date from item 1 For the Period To. Normalize to MM-DD-YYYY, including spaced boxed digits such as 0 8 2 5 2 0 2 5 -> 08-25-2025. Null if not visible.",
        },
        monthOfQuarter: {
          type: ["string", "null"],
          enum: ["first", "second", "third", null],
          description:
            "Use only the Part III taxBase placement under the 1st, 2nd, or 3rd Month of the Quarter. Return first, second, or third only when the selected taxBase belongs to exactly one monthly column. Return null when the selected taxBase is a total spanning multiple non-zero monthly columns, or when placement is not clear.",
        },
        payeeName: {
          ...nullableJsonSchemaType("string"),
          description:
            "Registered name of the payee or income recipient. Do not use the payor name.",
        },
        payeeTin: {
          ...nullableJsonSchemaType("string"),
          description:
            "TIN of the payee or income recipient. Digits only. Preserve visible leading zeroes. Null if not visible.",
        },
        payeeAddress: {
          ...nullableJsonSchemaType("string"),
          description:
            "Address of the payee or income recipient. Preserve visible text except trimming whitespace.",
        },
        payeeZip: {
          ...nullableJsonSchemaType("string"),
          description:
            "ZIP code of the payee or income recipient. Digits only when visible.",
        },
        payorName: {
          ...nullableJsonSchemaType("string"),
          description:
            "Registered name of the payor or withholding agent. Do not use the payee name.",
        },
        payorTin: {
          ...nullableJsonSchemaType("string"),
          description:
            "TIN of the payor or withholding agent. Digits only. Preserve visible leading zeroes. Null if not visible.",
        },
        payorAddress: {
          ...nullableJsonSchemaType("string"),
          description:
            "Address of the payor or withholding agent. Preserve visible text except trimming whitespace.",
        },
        payorZip: {
          ...nullableJsonSchemaType("string"),
          description:
            "ZIP code of the payor or withholding agent. Digits only when visible.",
        },
        atcCode: {
          ...nullableJsonSchemaType("string"),
          description:
            "Alphanumeric Tax Code from the Part III tax table, such as WCxxx or WIxxx, when visible.",
        },
        taxBase: {
          ...nullableJsonSchemaType("number"),
          description:
            "Amount of income payment or tax base. Return as number only, without commas or currency symbols.",
        },
        taxWithheld: {
          ...nullableJsonSchemaType("number"),
          description:
            "Tax withheld amount. Return as number only, without commas or currency symbols.",
        },
        printedName: {
          ...nullableJsonSchemaType("string"),
          description:
            "Typed or OCR-detected printed name in the payor signature block. Prefer ocr.zoneFallback.signature_block when present, even if main OCR conflicts. Return null when the value cannot be confidently separated from title, TIN, labels, dates, signature strokes, or accreditation rows.",
        },
        signatoryTitle: {
          ...nullableJsonSchemaType("string"),
          description:
            "Title or position of the person signing the certificate, only when clearly visible in the payor signature block. Prefer ocr.zoneFallback.signature_block when present. Return null when the title cannot be confidently separated from name, TIN, labels, dates, signature strokes, or accreditation rows.",
        },
        signatoryTin: {
          ...nullableJsonSchemaType("string"),
          description:
            "TIN of the signatory, if shown near the payor signature block. Prefer ocr.zoneFallback.signature_block when present. Digits only. Return null when the TIN cannot be confidently separated from dates, label text, signature marks, or accreditation rows.",
        },
        signaturePresent: {
          ...nullableJsonSchemaType("boolean"),
          description:
            "True only if the payor/withholding-agent signature block above the Payor/Payor's Authorized Representative label contains a visible handwritten, stamped, or digital signature mark. Do not evaluate the lower CONFORME/payee block. Do not count printed name, title, or TIN alone as a signature. False only when the payor block is visible and clearly blank. Null when missing, cropped out, unreadable, or only printed signer text is visible.",
        },
        signatureText: {
          ...nullableJsonSchemaType("string"),
          description:
            "Readable text of the actual signature only. Null for unreadable handwritten signatures or if no signature exists.",
        },
        companyName: {
          ...nullableJsonSchemaType("string"),
          description:
            "Company or organization associated with the signatory, if clearly indicated near the payor signature block.",
        },
        confidences: {
          type: "object",
          properties: Object.fromEntries(
            NORMALIZER_CONFIDENCE_FIELDS.map((field) => [
              field,
              nullableJsonSchemaType("number"),
            ]),
          ),
          required: [...NORMALIZER_CONFIDENCE_FIELDS],
          additionalProperties: false,
        },
        warnings: {
          type: "array",
          description:
            "Short warnings about ambiguous, unreadable, conflicting, or inferred-looking values.",
          items: {
            type: "string",
          },
        },
      },
      required: [...NORMALIZER_RESPONSE_FIELDS],
      additionalProperties: false,
    },
  },
} as const;

export const SIGNATURE_BLOCK_DOCUMENT_ANNOTATION_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: SIGNATURE_BLOCK_RESPONSE_SCHEMA_NAME,
    strict: true,
    schema: {
      type: "object",
      properties: {
        printedName: {
          ...nullableJsonSchemaType("string"),
          description:
            "Typed or OCR-detected printed name directly above the payor/payor's authorized representative/tax agent signature label. Return null when the value cannot be confidently separated from title, TIN, labels, dates, signature strokes, or accreditation rows.",
        },
        signatoryTitle: {
          ...nullableJsonSchemaType("string"),
          description:
            "Title or position of the signer only when clearly visible in the payor signature block. Return null when unclear or mixed into labels, dates, or accreditation rows.",
        },
        signatoryTin: {
          ...nullableJsonSchemaType("string"),
          description:
            "TIN of the signer if clearly shown near the payor signature block. Digits only. Return null when the number belongs to accreditation, issue date, expiry date, payee, payor, or another labeled field.",
        },
        signaturePresent: {
          ...nullableJsonSchemaType("boolean"),
          description:
            "True only if the payor signature block contains a visible handwritten, stamped, or digital signature mark. Do not count printed name, title, TIN, or labels alone as a signature. False only when the block is visible and clearly blank. Null when cropped, unreadable, or ambiguous.",
        },
        signatureText: {
          ...nullableJsonSchemaType("string"),
          description:
            "Readable text from the actual signature mark only. Null for unreadable handwritten marks, labels, printed names, or when no signature exists.",
        },
        confidences: {
          type: "object",
          properties: Object.fromEntries(
            SIGNATURE_BLOCK_CONFIDENCE_FIELDS.map((field) => [
              field,
              nullableJsonSchemaType("number"),
            ]),
          ),
          required: [...SIGNATURE_BLOCK_CONFIDENCE_FIELDS],
          additionalProperties: false,
        },
        warnings: {
          type: "array",
          description:
            "Short warnings about ambiguous, unreadable, conflicting, or inferred-looking signer values.",
          items: {
            type: "string",
          },
        },
      },
      required: [...SIGNATURE_BLOCK_RESPONSE_FIELDS],
      additionalProperties: false,
    },
  },
} as const;

export const BIR2307_DOCUMENT_ANNOTATION_PROMPT = `
You are extracting structured data from a Philippine BIR Form 2307 Certificate of Creditable Tax Withheld at Source.

Return only values that are visible or strongly supported by the document. Use null when a field is missing, unreadable, ambiguous, or not applicable. Do not hallucinate. Do not infer values from filenames, surrounding system metadata, or prior documents. Do not copy field labels as values.

Important field rules:
- The payee is the income recipient. The payor is the withholding agent.
- Do not swap payee and payor.
- Preserve extracted text exactly except for trimming spaces, unless a rule below says to normalize a field format.
- TIN fields must contain digits only. Remove spaces, hyphens, commas, labels, OCR separators, and all non-digit characters. Preserve visible leading zeroes. Do not pad, truncate, or invent digits.
- BIR 2307 boxed TIN OCR can include trailing "1" box artifacts in item 2 and item 6 rows. Decode only inside labeled TIN rows when the resulting length is a valid Philippine TIN length.
- periodCovered must be a range in MM-DD-YYYY to MM-DD-YYYY format.
- periodStart must be the starting date only in MM-DD-YYYY format.
- periodEnd must be the ending date only in MM-DD-YYYY format.
- If dates appear as 08312025, 08/31/2025, 2025-08-31, Aug 31 2025, or similar, normalize to MM-DD-YYYY.
- Item 1 period dates can appear as spaced boxed digits, for example "For the Period From 0 7 2 6 2 0 2 5 To 0 8 2 5 2 0 2 5"; extract this as periodStart 07-26-2025, periodEnd 08-25-2025, and periodCovered 07-26-2025 to 08-25-2025.
- Prefer a complete item 1 period row from ocr.zoneFallback.header_period or ocr.zoneFallback.payee_payor_info when the main OCR period row is incomplete or conflicting.
- monthOfQuarter must come from the selected Part III taxBase placement under the 1st, 2nd, or 3rd month column. Do not infer monthOfQuarter from periodEnd.
- Return first, second, or third only when the selected taxBase belongs to exactly one monthly column. If the selected taxBase is a bottom Part III Total row, inspect the 1st, 2nd, and 3rd monthly total cells.
- For a bottom Total row with monthly totals 0.00, 216.09, 0.00 and total taxBase 216.09, return second.
- For a bottom Total row with multiple non-zero monthly totals, such as 51,675.41, 93,120.95, and 202,891.10 with total taxBase 347,687.46, return null.
- For a single detail row with a single non-zero monthly amount, such as 2.13 in the 1st month and total taxBase 2.13, return first. Use null when placement is unclear.
- taxBase and taxWithheld must be numbers only, without currency symbols, commas, or parentheses. If a value is negative because of parentheses, return the negative number.
- atcCode must be the withholding tax ATC code from the tax table, such as WCxxx or WIxxx, when visible.
- printedName, signatoryTitle, and signatoryTin come from the payor/withholding-agent signature block above CONFORME.
- When ocr.zoneFallback includes a signature_block, treat that signature_block as the authoritative evidence for printedName, signatoryTitle, signatoryTin, signaturePresent, and signatureText.
- If the main OCR text conflicts with ocr.zoneFallback.signature_block for signer fields, prefer the signature_block value.
- If signer text appears on one line, split printedName, signatoryTitle, and signatoryTin only when each piece is clear. Otherwise return null for the uncertain signer fields.
- Never return label fragments such as Authorized Representative, Tax Agent, Include Title/Designation and TIN, Regulatory Agent Date, Date of Issue, or Date of Expiry as printedName, signatoryTitle, or signatoryTin.
- Do not use label text, dates, signature strokes, accreditation numbers, accreditation date rows, issue dates, or expiry dates as signer values.
- signaturePresent is true only when the payor/withholding-agent signature block has visible evidence of a handwritten, stamped, or digital signature mark.
- Do not count printedName, signatoryTitle, or signatoryTin alone as a signature.
- Do not treat labels such as Signature over Printed Name as signature text.
- Do not use the lower CONFORME/payee signature block for signaturePresent.
- Return signaturePresent false only when the payor signature block is visible and clearly blank.
- Return signaturePresent null when the payor signature block is missing, cropped out, unreadable, or only printed signer text is visible.
- signatureText is only readable text from the actual signature mark. Use null for unreadable handwritten marks.
- signatoryTitle, signatoryTin, and companyName must come from nearby signature/payor text only when clearly indicated.

Return concise warnings for ambiguous, conflicting, or low-confidence fields.
`;

export const SIGNATURE_BLOCK_DOCUMENT_ANNOTATION_PROMPT = `
You are extracting signer fields from a cropped payor signature block of a Philippine BIR Form 2307.

This crop may contain only the declaration text, signer line, signature label, accreditation row, and CONFORME/payee area. Do not reject the crop just because the full BIR 2307 header, tax table, payee, or payor sections are absent.

Return only values visible in the cropped payor/withholding-agent signature block above CONFORME. Use null when a field is missing, unreadable, ambiguous, or not applicable. Do not hallucinate. Do not infer values from filenames, surrounding system metadata, or prior documents. Do not copy field labels as values.

Important signer rules:
- printedName is the typed or OCR-detected name directly above the Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent label.
- signatoryTitle is the signer's title or designation only when clearly visible near the printed name.
- signatoryTin is the signer's TIN only when clearly visible near the printed name. Return digits only.
- Do not use the Tax Agent Accreditation No., Attorney's Roll No., Date of Issue, Date of Expiry, payee/payor TIN, label text, or privacy/declaration text as signatoryTin.
- Never return label fragments such as Authorized Representative, Tax Agent, Include Title/Designation and TIN, Regulatory Agent Date, Date of Issue, or Date of Expiry as printedName, signatoryTitle, or signatoryTin.
- If the signer line contains a name with no visible title or signer TIN, return the name and null for the title/TIN.
- Stop at CONFORME. Do not use the lower payee signature block for payor signer fields.
- signaturePresent is true only when the payor signature block contains visible handwritten, stamped, or digital signature marks.
- Do not count printedName, signatoryTitle, signatoryTin, or labels alone as a signature.
- signatureText is only readable text from the actual signature mark. Use null for unreadable handwritten marks, printed names, labels, or no signature.

Return concise warnings for ambiguous, conflicting, or low-confidence signer fields.
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function toBooleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const lower = trimmed.toLowerCase();
    if (lower === "true") {
      return true;
    }

    if (lower === "false") {
      return false;
    }
  }

  return undefined;
}

function toMonthOfQuarterOrUndefined(
  value: unknown,
): MonthOfQuarter | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (MONTH_OF_QUARTER_VALUES.includes(normalized as MonthOfQuarter)) {
    return normalized as MonthOfQuarter;
  }

  return undefined;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return [];
  }

  return trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeAtcCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.trim().toUpperCase().match(ATC_CODE_PATTERN);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return `${match[1]}${match[2]}`;
}

function isSameMoneyValue(left: number | undefined, right: number | undefined) {
  return (
    typeof left === "number" &&
    typeof right === "number" &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) < 0.01
  );
}

function findPairedMonthlyMatchingIndex(
  cellsAfterAtc: string[],
  taxBase: number,
): number {
  const monthlyPairs = [
    cellsAfterAtc.slice(0, 2),
    cellsAfterAtc.slice(2, 4),
    cellsAfterAtc.slice(4, 6),
  ];

  return monthlyPairs.findIndex((pair) =>
    pair.some((cell) => isSameMoneyValue(parseMoney(cell), taxBase)),
  );
}

function isEmptyAmountCell(cell: string): boolean {
  const trimmed = cell.trim();
  return trimmed.length === 0 || /^[-\u2013\u2014]+$/u.test(trimmed);
}

function hasPairedMonthlySpacing(cellsAfterAtc: string[]): boolean {
  return cellsAfterAtc.slice(0, 6).some(isEmptyAmountCell);
}

function isNonZeroMoneyValue(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

function getMonthOfQuarterAt(index: number): MonthOfQuarter | undefined {
  return MONTH_OF_QUARTER_VALUES[index];
}

function inferMonthOfQuarterFromMonthlyTotals(
  monthlyAmounts: Array<number | undefined>,
): MonthOfQuarterInference {
  const nonZeroIndexes = monthlyAmounts
    .map((amount, index) => ({ amount, index }))
    .filter(({ amount }) => isNonZeroMoneyValue(amount))
    .map(({ index }) => index)
    .filter((index) => index >= 0 && index < MONTH_OF_QUARTER_VALUES.length);

  if (nonZeroIndexes.length === 1) {
    const value = getMonthOfQuarterAt(nonZeroIndexes[0]);
    return value ? { kind: "month", value } : { kind: "unknown" };
  }

  if (nonZeroIndexes.length > 1) {
    return { kind: "clear" };
  }

  return { kind: "unknown" };
}

function getAmountCellCandidates(cellsAfterLabel: string[]): string[][] {
  const candidates = [cellsAfterLabel];
  if (
    cellsAfterLabel.length >= 5 &&
    parseMoney(cellsAfterLabel[0]) === undefined
  ) {
    candidates.push(cellsAfterLabel.slice(1));
  }

  return candidates;
}

function inferMonthOfQuarterFromSummaryCells(
  cellsAfterLabel: string[],
  taxBase: number,
): MonthOfQuarterInference {
  for (const amountCells of getAmountCellCandidates(cellsAfterLabel)) {
    if (amountCells.length < 4) {
      continue;
    }

    const monthlyAmounts = amountCells
      .slice(0, 3)
      .map((cell) => parseMoney(cell));
    const totalAmount = parseMoney(amountCells[3]);
    if (isSameMoneyValue(totalAmount, taxBase)) {
      return inferMonthOfQuarterFromMonthlyTotals(monthlyAmounts);
    }
  }

  return { kind: "unknown" };
}

function inferMonthOfQuarterFromTotalRow(
  cells: string[],
  taxBase: number,
): MonthOfQuarterInference {
  const totalIndex = cells.findIndex((cell) => /^total$/iu.test(cell.trim()));
  if (totalIndex < 0) {
    return { kind: "unknown" };
  }

  return inferMonthOfQuarterFromSummaryCells(
    cells.slice(totalIndex + 1),
    taxBase,
  );
}

function inferMonthOfQuarterFromAtcRow(input: {
  cells: string[];
  expectedAtcCode?: string;
  taxBase: number;
}): MonthOfQuarterInference {
  const atcIndex = input.cells.findIndex((cell) => {
    const cellAtcCode = normalizeAtcCode(cell);
    return input.expectedAtcCode
      ? cellAtcCode === input.expectedAtcCode
      : Boolean(cellAtcCode);
  });
  if (atcIndex < 0) {
    return { kind: "unknown" };
  }

  const cellsAfterAtc = input.cells.slice(atcIndex + 1);
  const summaryInference = inferMonthOfQuarterFromSummaryCells(
    cellsAfterAtc,
    input.taxBase,
  );
  if (summaryInference.kind !== "unknown") {
    return summaryInference;
  }

  const monthlyAmounts = cellsAfterAtc.slice(0, 3);
  const positionedMatchingIndex = monthlyAmounts.findIndex((cell) =>
    isSameMoneyValue(parseMoney(cell), input.taxBase),
  );

  if (positionedMatchingIndex >= 0) {
    const value = getMonthOfQuarterAt(positionedMatchingIndex);
    return value ? { kind: "month", value } : { kind: "unknown" };
  }

  if (hasPairedMonthlySpacing(cellsAfterAtc)) {
    const pairedMatchingIndex = findPairedMonthlyMatchingIndex(
      cellsAfterAtc,
      input.taxBase,
    );
    if (pairedMatchingIndex >= 0) {
      const value = getMonthOfQuarterAt(pairedMatchingIndex);
      return value ? { kind: "month", value } : { kind: "unknown" };
    }
  }

  const compactMonthlyAmounts = cellsAfterAtc
    .map((cell) => parseMoney(cell))
    .filter((value): value is number => typeof value === "number")
    .slice(0, 3);
  const compactMatchingIndex = compactMonthlyAmounts.findIndex((amount) =>
    isSameMoneyValue(amount, input.taxBase),
  );

  if (compactMatchingIndex >= 0) {
    const value = getMonthOfQuarterAt(compactMatchingIndex);
    return value ? { kind: "month", value } : { kind: "unknown" };
  }

  return { kind: "unknown" };
}

function inferMonthOfQuarterFromTaxBasePlacement(input: {
  atcCode?: string;
  ocrText: string;
  taxBase?: number;
}): MonthOfQuarterInference {
  if (
    typeof input.taxBase !== "number" ||
    !Number.isFinite(input.taxBase) ||
    input.taxBase <= 0
  ) {
    return { kind: "unknown" };
  }

  const expectedAtcCode = normalizeAtcCode(input.atcCode);
  const tableRows = input.ocrText
    .replace(/\\n/gu, "\n")
    .split(/\r?\n/u)
    .map((row) => splitMarkdownTableRow(row))
    .filter((cells) => cells.length > 0);

  for (const cells of tableRows) {
    const totalInference = inferMonthOfQuarterFromTotalRow(
      cells,
      input.taxBase,
    );
    if (totalInference.kind !== "unknown") {
      return totalInference;
    }
  }

  for (const cells of tableRows) {
    const atcInference = inferMonthOfQuarterFromAtcRow({
      cells,
      expectedAtcCode,
      taxBase: input.taxBase,
    });
    if (atcInference.kind !== "unknown") {
      return atcInference;
    }
  }

  return { kind: "unknown" };
}

function sanitizeConfidenceMap(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      if (raw === null || raw === undefined) {
        return undefined;
      }

      if (typeof raw === "string" && raw.trim().length === 0) {
        return undefined;
      }

      const numeric = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(numeric)) {
        return undefined;
      }

      return [key, Math.min(1, Math.max(0, numeric))] as const;
    })
    .filter((entry): entry is readonly [string, number] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const warnings = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);

  return warnings.length > 0 ? warnings : undefined;
}

export function getMetadataStatus(metadata: Record<string, unknown>): string {
  const zoneOcrFallback = metadata.zoneOcrFallback;
  if (!isRecord(zoneOcrFallback)) {
    return "not_run";
  }

  return typeof zoneOcrFallback.status === "string"
    ? zoneOcrFallback.status
    : "unknown";
}

export function getDocumentAnnotation(
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const annotation = raw.document_annotation ?? raw.documentAnnotation;
  if (isRecord(annotation)) {
    return annotation;
  }

  if (typeof annotation === "string" && annotation.trim().length > 0) {
    try {
      const parsed = JSON.parse(annotation);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function getZoneFallbackBlocks(
  raw: Record<string, unknown>,
): Array<{ zoneId: string; content: string }> {
  const blocks = raw.zoneOcrFallbackText;
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .filter(isRecord)
    .map((block) => {
      const text = typeof block.text === "string" ? block.text.trim() : "";
      const markdown =
        typeof block.markdown === "string" ? block.markdown.trim() : "";

      return {
        zoneId: typeof block.zoneId === "string" ? block.zoneId : "unknown",
        content: markdown || text,
      };
    })
    .filter((block) => block.content.length > 0);
}

function getAnnotationPageText(raw: Record<string, unknown> | undefined) {
  const pages = Array.isArray(raw?.pages) ? raw.pages : [];
  return pages
    .filter(isRecord)
    .flatMap((page) => [
      toStringOrUndefined(page.markdown),
      toStringOrUndefined(page.text),
      toStringOrUndefined(page.content),
    ])
    .filter((value): value is string => Boolean(value));
}

function getAnnotationBlockText(raw: Record<string, unknown> | undefined) {
  const pages = Array.isArray(raw?.pages) ? raw.pages : [];
  return pages
    .filter(isRecord)
    .flatMap((page) => (Array.isArray(page.blocks) ? page.blocks : []))
    .filter(isRecord)
    .map((block) => toStringOrUndefined(block.content))
    .filter((value): value is string => Boolean(value));
}

export function buildNormalizerOcrText(input: {
  extraction: ExtractionPayload;
  annotationRaw?: Record<string, unknown>;
}): string {
  return [
    getMainExtractionPlainText(input.extraction),
    ...getZoneFallbackBlocks(input.extraction.raw).map(
      (block) => block.content,
    ),
    ...getAnnotationPageText(input.annotationRaw),
    ...getAnnotationBlockText(input.annotationRaw),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
}

function toTinStringOrUndefined(value: unknown): string | undefined {
  return normalizeTinDigits(value) ?? undefined;
}

function getPartyEvidenceTexts(input: {
  extraction: ExtractionPayload;
  annotationRaw?: Record<string, unknown>;
}): string[] {
  const zoneFallbackBlocks = getZoneFallbackBlocks(input.extraction.raw);
  const payeePayorBlocks = zoneFallbackBlocks.filter(
    (block) => block.zoneId === "payee_payor_info",
  );
  const otherZoneBlocks = zoneFallbackBlocks.filter(
    (block) => block.zoneId !== "payee_payor_info",
  );

  return [
    ...payeePayorBlocks.map((block) => block.content),
    ...otherZoneBlocks.map((block) => block.content),
    getMainExtractionPlainText(input.extraction),
    ...getAnnotationPageText(input.annotationRaw),
    ...getAnnotationBlockText(input.annotationRaw),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function decodeBoxedTinToken(token: string): string | undefined {
  if (/^\d$/u.test(token)) {
    return token;
  }

  if (/^\d1$/u.test(token)) {
    return token[0];
  }

  return undefined;
}

function decodeMergedBoxedTinDigits(value: string): string | undefined {
  const digits = value.replace(/\D/gu, "");
  if (!digits) {
    return undefined;
  }

  let artifactCount = 0;
  let decoded = "";
  for (let index = 0; index < digits.length; index += 1) {
    decoded += digits[index];
    if (digits[index + 1] === "1") {
      artifactCount += 1;
      index += 1;
    }
  }

  return artifactCount > 0 ? decoded : undefined;
}

function decodeBoxedTinCell(cell: string): string | undefined {
  const rawTokens = cell.match(/\d+/gu) ?? [];
  if (rawTokens.length === 0) {
    return undefined;
  }

  const tokenDigits = rawTokens.map(decodeBoxedTinToken);
  if (tokenDigits.every((digit) => digit !== undefined)) {
    return tokenDigits.join("");
  }

  return decodeMergedBoxedTinDigits(cell);
}

function decodeStandardTinGroups(groups: string[]): string | undefined {
  if (groups.length !== 4) {
    return undefined;
  }

  const [first, second, third, branch] = groups;
  if (
    first.length !== 3 ||
    second.length !== 3 ||
    third.length !== 3 ||
    (branch.length !== 3 && branch.length !== 5)
  ) {
    return undefined;
  }

  const decoded = groups.join("");
  return CANONICAL_TIN_LENGTHS.has(decoded.length) ? decoded : undefined;
}

function decodeStandardTinTableCells(row: string): string | undefined {
  const tinLabel = /taxpayer identification number\s*\(tin\)/iu;
  const cells = splitMarkdownTableRow(row);
  const labelIndex = cells.findIndex((cell) => tinLabel.test(cell));
  if (labelIndex < 0) {
    return undefined;
  }

  const digitGroups = cells
    .slice(labelIndex + 1)
    .map((cell) => cell.replace(/\D/gu, ""))
    .filter(Boolean);

  return decodeStandardTinGroups(digitGroups);
}

function decodeBoxedTinTableCells(row: string): string | undefined {
  const tinLabel = /taxpayer identification number\s*\(tin\)/iu;
  const standardTin = decodeStandardTinTableCells(row);
  if (standardTin) {
    return standardTin;
  }

  const cells = splitMarkdownTableRow(row);
  const labelIndex = cells.findIndex((cell) => tinLabel.test(cell));
  if (labelIndex < 0) {
    return undefined;
  }

  const valueCells = cells
    .slice(labelIndex + 1)
    .filter((cell) => /\d/u.test(cell) && !/^-+$/u.test(cell));
  if (valueCells.length < 3) {
    return undefined;
  }

  const decodedCells = valueCells.map(decodeBoxedTinCell);
  if (decodedCells.some((cell) => cell === undefined)) {
    return undefined;
  }

  const decoded = decodedCells.join("");
  return CANONICAL_TIN_LENGTHS.has(decoded.length) ? decoded : undefined;
}

function decodeBoxedTinRow(row: string): string | undefined {
  const tinLabel = /taxpayer identification number\s*\(tin\)/iu;
  const decodedFromCells = decodeBoxedTinTableCells(row);
  if (decodedFromCells) {
    return decodedFromCells;
  }

  const labelMatch = tinLabel.exec(row);
  if (!labelMatch) {
    return undefined;
  }

  const rawTokens =
    row.slice(labelMatch.index + labelMatch[0].length).match(/\d+/gu) ?? [];
  const standardTin = decodeStandardTinGroups(rawTokens);
  if (standardTin) {
    return standardTin;
  }

  const digits = rawTokens.map(decodeBoxedTinToken);

  if (digits.length === 0 || digits.some((digit) => digit === undefined)) {
    return undefined;
  }

  const decoded = digits.join("");
  return CANONICAL_TIN_LENGTHS.has(decoded.length) ? decoded : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function getTinRowItemNumber(field: "payeeTin" | "payorTin"): string {
  return field === "payeeTin" ? "2" : "6";
}

function createItemLabelPattern(itemNumber: string): RegExp {
  return new RegExp(`^\\s*\\|?\\s*${escapeRegExp(itemNumber)}\\b`, "iu");
}

function extractTinFromOcrText(
  itemNumber: string,
  ocrText: string,
): string | undefined {
  const itemLabel = new RegExp(
    `^\\s*\\|?\\s*${escapeRegExp(itemNumber)}\\b\\s+Taxpayer Identification Number\\s*\\(TIN\\)`,
    "iu",
  );

  for (const row of ocrText.replace(/\\n/gu, "\n").split(/\r?\n/u)) {
    if (!itemLabel.test(row)) {
      continue;
    }

    const tin = decodeBoxedTinRow(row);
    if (tin) {
      return tin;
    }
  }

  return undefined;
}

function extractBoxedTinFromOcrText(
  field: "payeeTin" | "payorTin",
  ocrText: string,
): string | undefined {
  return extractTinFromOcrText(getTinRowItemNumber(field), ocrText);
}

function cleanTableRowText(row: string): string {
  const cells = splitMarkdownTableRow(row);
  const text = cells.length > 0 ? cells.filter(Boolean).join(" ") : row.trim();

  return text.replace(/\s+/gu, " ").trim();
}

function isItemLabelRow(value: string): boolean {
  return /^(?:\d+[A-Z]?|[A-Z])\b/u.test(value.trim());
}

function isAnyItemLabelRow(value: string): boolean {
  return /^\s*\|?\s*\d+[A-Z]?\b/iu.test(value);
}

function isUsablePartyValue(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  return !/^(?:part\s+[ivx]+|income payments|tax withheld|foreign address)\b/iu.test(
    value,
  );
}

function cleanItemValueFromLabelRow(
  row: string,
  itemNumber: string,
  labelPattern: RegExp,
): string | undefined {
  const rowText = cleanTableRowText(row).replace(
    new RegExp(`^${escapeRegExp(itemNumber)}\\b\\s*`, "iu"),
    "",
  );
  const labelMatch = labelPattern.exec(rowText);
  if (!labelMatch) {
    return undefined;
  }

  const value = rowText
    .slice(labelMatch.index + labelMatch[0].length)
    .replace(/^\s*\([^)]*\)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  return isUsablePartyValue(value) ? value : undefined;
}

function cleanStandalonePartyValueRow(row: string): string | undefined {
  const value = cleanTableRowText(row);
  if (!isUsablePartyValue(value) || isItemLabelRow(value)) {
    return undefined;
  }

  return value;
}

function extractItemValueFromOcrText(input: {
  itemNumber: string;
  labelPattern: RegExp;
  ocrText: string;
}): string | undefined {
  const itemLabel = createItemLabelPattern(input.itemNumber);
  const rows = input.ocrText.replace(/\\n/gu, "\n").split(/\r?\n/u);

  for (const [index, row] of rows.entries()) {
    if (!itemLabel.test(row)) {
      continue;
    }

    const value = cleanItemValueFromLabelRow(
      row,
      input.itemNumber,
      input.labelPattern,
    );
    if (value) {
      return value;
    }

    for (const nextRow of rows.slice(index + 1, index + 3)) {
      const nextValue = cleanStandalonePartyValueRow(nextRow);
      if (nextValue) {
        return nextValue;
      }

      if (isAnyItemLabelRow(nextRow)) {
        break;
      }
    }
  }

  return undefined;
}

function extractFirstEvidenceValue(
  evidenceTexts: string[],
  extract: (text: string) => string | undefined,
): string | undefined {
  for (const evidenceText of evidenceTexts) {
    const value = extract(evidenceText);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function formatIsoDateAsUs(isoDate: string): string | undefined {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return undefined;
  }

  return `${month}-${day}-${year}`;
}

function formatMmddyyyyDigits(rawDigits: string): string | undefined {
  const candidate =
    rawDigits.length >= 8
      ? rawDigits.slice(0, 8)
      : rawDigits.length === 6
        ? `${rawDigits.slice(0, 4)}20${rawDigits.slice(4)}`
        : undefined;
  if (!candidate) {
    return undefined;
  }

  const month = Number(candidate.slice(0, 2));
  const day = Number(candidate.slice(2, 4));
  const year = Number(candidate.slice(4, 8));
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 1900 ||
    year > 2100
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

  return `${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}-${String(year).padStart(4, "0")}`;
}

function getMaxReasonablePeriodYear(auditStartedAt: string): number {
  const anchor = new Date(auditStartedAt);
  const anchorYear = Number.isNaN(anchor.getTime())
    ? new Date().getUTCFullYear()
    : anchor.getUTCFullYear();

  return anchorYear + MAX_REASONABLE_BIR2307_FUTURE_YEARS;
}

function isoDateToUtcDate(isoDate: string | undefined): Date | undefined {
  if (!isoDate) {
    return undefined;
  }

  const [yearPart, monthPart, dayPart] = isoDate.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
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

function isReasonableBir2307PeriodDate(
  isoDate: string | undefined,
  auditStartedAt: string,
): boolean {
  const parsed = isoDateToUtcDate(isoDate);
  if (!parsed) {
    return false;
  }

  const year = parsed.getUTCFullYear();
  return (
    year >= MIN_REASONABLE_BIR2307_PERIOD_YEAR &&
    year <= getMaxReasonablePeriodYear(auditStartedAt)
  );
}

function getBir2307PeriodRangeIssue(input: {
  periodStart: string | undefined;
  periodEnd: string | undefined;
  auditStartedAt: string;
}): string | undefined {
  const startIso = extractPeriodStartDate(input.periodStart);
  const endIso = extractPeriodEndDate(input.periodEnd);
  if (!startIso || !endIso) {
    return undefined;
  }

  if (!isReasonableBir2307PeriodDate(startIso, input.auditStartedAt)) {
    return "period_start_year_out_of_range";
  }

  if (!isReasonableBir2307PeriodDate(endIso, input.auditStartedAt)) {
    return "period_end_year_out_of_range";
  }

  const start = isoDateToUtcDate(startIso);
  const end = isoDateToUtcDate(endIso);
  if (!start || !end) {
    return undefined;
  }

  const durationDays =
    (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  if (durationDays < 0) {
    return "period_end_before_start";
  }

  if (durationDays > MAX_REASONABLE_BIR2307_PERIOD_DAYS) {
    return "period_range_too_long";
  }

  return undefined;
}

function appendWarning(
  warnings: string[] | undefined,
  warning: string | undefined,
): string[] | undefined {
  if (!warning) {
    return warnings;
  }

  return [...(warnings ?? []), warning];
}

function decodePeriodDateFragment(fragment: string): string | undefined {
  const isoDate = extractPeriodStartDate(fragment);
  const normalizedDate = isoDate ? formatIsoDateAsUs(isoDate) : undefined;
  if (normalizedDate) {
    return normalizedDate;
  }

  const digits = fragment.replace(/\D/gu, "");
  return formatMmddyyyyDigits(digits);
}

function extractPeriodFromItemOneCandidate(
  candidate: string,
  auditStartedAt: string,
):
  | {
      periodStart: string;
      periodEnd: string;
      periodCovered: string;
    }
  | undefined {
  const row = cleanTableRowText(candidate);
  if (!/\b1\b[\s\S]{0,80}\bfor\s+the\s+period\b/iu.test(row)) {
    return undefined;
  }

  const match =
    /\bfor\s+the\s+period\b[\s\S]{0,80}?\bfrom\b(?<start>[\s\S]{1,120}?)\bto\b(?<end>[\s\S]{1,120})/iu.exec(
      row,
    );
  if (!match?.groups) {
    return undefined;
  }

  const periodStart = decodePeriodDateFragment(match.groups.start);
  const periodEnd = decodePeriodDateFragment(match.groups.end);
  if (!periodStart || !periodEnd) {
    return undefined;
  }
  if (
    getBir2307PeriodRangeIssue({
      periodStart,
      periodEnd,
      auditStartedAt,
    })
  ) {
    return undefined;
  }

  return {
    periodStart,
    periodEnd,
    periodCovered: `${periodStart} to ${periodEnd}`,
  };
}

function extractPeriodFromOcrText(
  ocrText: string,
  auditStartedAt: string,
):
  | {
      periodStart: string;
      periodEnd: string;
      periodCovered: string;
    }
  | undefined {
  const rows = ocrText.replace(/\\n/gu, "\n").split(/\r?\n/u);

  for (const [index, row] of rows.entries()) {
    if (!/\b1\b[\s\S]{0,80}\bfor\s+the\s+period\b/iu.test(row)) {
      continue;
    }

    const period = extractPeriodFromItemOneCandidate(
      [row, rows[index + 1] ?? ""].join(" "),
      auditStartedAt,
    );
    if (period) {
      return period;
    }
  }

  return undefined;
}

function getPeriodEvidenceTexts(input: {
  extraction: ExtractionPayload;
  annotationRaw?: Record<string, unknown>;
}): string[] {
  const zoneFallbackBlocks = getZoneFallbackBlocks(input.extraction.raw);
  const preferredZoneBlocks = zoneFallbackBlocks.filter((block) =>
    ["header_period", "payee_payor_info"].includes(block.zoneId),
  );
  const otherZoneBlocks = zoneFallbackBlocks.filter(
    (block) => !["header_period", "payee_payor_info"].includes(block.zoneId),
  );

  return [
    ...preferredZoneBlocks.map((block) => block.content),
    ...otherZoneBlocks.map((block) => block.content),
    getMainExtractionPlainText(input.extraction),
    ...getAnnotationPageText(input.annotationRaw),
    ...getAnnotationBlockText(input.annotationRaw),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function extractBir2307PeriodEvidence(
  evidenceTexts: string[],
  auditStartedAt: string,
):
  | {
      periodStart: string;
      periodCovered: string;
      periodEnd: string;
    }
  | undefined {
  for (const evidenceText of evidenceTexts) {
    const period = extractPeriodFromOcrText(evidenceText, auditStartedAt);
    if (period) {
      return period;
    }
  }

  return undefined;
}

function normalizeZipValue(value: string | undefined): string | undefined {
  return value?.match(/\b\d{4}\b/u)?.[0];
}

function cleanAddressValue(value: string | undefined): string | undefined {
  const address = value
    ?.replace(/\b(?:4A|8A)\s+Zip\s+Code\b.*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();

  return address && isUsablePartyValue(address) ? address : undefined;
}

function extractBir2307PartyEvidence(evidenceTexts: string[]): {
  payee: {
    name?: string;
    tin?: string;
    address?: string;
    zip?: string;
  };
  payor: {
    name?: string;
    tin?: string;
    address?: string;
    zip?: string;
  };
} {
  const payeeAddress = extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
    extractItemValueFromOcrText({
      itemNumber: "4",
      labelPattern: /registered\s+address\b/iu,
      ocrText,
    }),
  );
  const payorAddress = extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
    extractItemValueFromOcrText({
      itemNumber: "8",
      labelPattern: /registered\s+address\b/iu,
      ocrText,
    }),
  );

  return {
    payee: {
      tin: extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
        extractTinFromOcrText("2", ocrText),
      ),
      name: extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
        extractItemValueFromOcrText({
          itemNumber: "3",
          labelPattern: /payee'?s\s+name\b/iu,
          ocrText,
        }),
      ),
      address: cleanAddressValue(payeeAddress),
      zip:
        extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
          normalizeZipValue(
            extractItemValueFromOcrText({
              itemNumber: "4A",
              labelPattern: /zip\s+code\b/iu,
              ocrText,
            }),
          ),
        ) ?? normalizeZipValue(payeeAddress),
    },
    payor: {
      tin: extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
        extractTinFromOcrText("6", ocrText),
      ),
      name: extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
        extractItemValueFromOcrText({
          itemNumber: "7",
          labelPattern: /payor'?s\s+name\b/iu,
          ocrText,
        }),
      ),
      address: cleanAddressValue(payorAddress),
      zip:
        extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
          normalizeZipValue(
            extractItemValueFromOcrText({
              itemNumber: "8A",
              labelPattern: /zip\s+code\b/iu,
              ocrText,
            }),
          ),
        ) ?? normalizeZipValue(payorAddress),
    },
  };
}

function toPartyTinStringOrUndefined(
  value: unknown,
  field: "payeeTin" | "payorTin",
  evidenceTexts: string[],
): string | undefined {
  return (
    extractFirstEvidenceValue(evidenceTexts, (ocrText) =>
      extractBoxedTinFromOcrText(field, ocrText),
    ) ?? toTinStringOrUndefined(value)
  );
}

function normalizeEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getPayorSignatureEvidenceText(ocrText: string): string {
  const normalizedLineBreaks = ocrText.replace(/\\n/gu, "\n");
  const conformeIndex = normalizedLineBreaks.search(/\bconforme\s*:/iu);
  return conformeIndex >= 0
    ? normalizedLineBreaks.slice(0, conformeIndex)
    : normalizedLineBreaks;
}

function hasVisiblePayorSignatureBlock(ocrText: string): boolean {
  const payorSection = normalizeEvidenceText(
    getPayorSignatureEvidenceText(ocrText),
  );

  return (
    payorSection.includes("signature over printed name of payor") ||
    payorSection.includes("payor s authorized representative") ||
    payorSection.includes("payor authorized representative")
  );
}

function hasLowSignerFieldConfidence(confidence: number | undefined): boolean {
  return (
    typeof confidence === "number" &&
    confidence <= SIGNER_FIELD_LOW_CONFIDENCE_THRESHOLD
  );
}

function trustedSignerStringFromAnnotation(
  value: unknown,
  confidence: number | undefined,
): string | undefined {
  return hasLowSignerFieldConfidence(confidence)
    ? undefined
    : toStringOrUndefined(value);
}

function trustedSignerTinFromAnnotation(
  value: unknown,
  confidence: number | undefined,
): string | undefined {
  return hasLowSignerFieldConfidence(confidence)
    ? undefined
    : toTinStringOrUndefined(value);
}

function hasBir2307SignerRecoveryContext(input: {
  normalized: Record<string, unknown>;
  ocrText: string;
}): boolean {
  const isBir2307 = toBooleanOrUndefined(input.normalized.isBir2307);
  if (isBir2307 === false) {
    return false;
  }

  return (
    isBir2307 === true ||
    /\b(?:bir\s+form\s+no\.?\s*2307|certificate\s+of\s+creditable\s+tax\s+withheld)\b/iu.test(
      input.ocrText,
    )
  );
}

function getSignerRecoveryVisualReason(
  detection: SignatureVisualSignerRecoveryEvidence | undefined,
): SignerTextFallbackResult["audit"]["visualReason"] | undefined {
  if (!detection) {
    return undefined;
  }

  if (detection.status === "detected" && detection.signaturePresent === true) {
    return "detected_signature";
  }

  if (
    detection.anchorOcrEligible === true &&
    detection.structure?.payorSignerBandVisible === true
  ) {
    return "visible_signer_band";
  }

  return undefined;
}

function normalizeSignerEvidenceLines(text: string): string[] {
  return text
    .replace(/\\n/gu, "\n")
    .split(/\r?\n/u)
    .map((line) =>
      cleanTableRowText(line)
        .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function isPayorSignatureLabel(line: string): boolean {
  return /\bsignature\s+over\s+printed\s+name\s+of\s+payor\b/iu.test(line);
}

function isPayeeSignatureLabel(line: string): boolean {
  return /\bsignature\s+over\s+printed\s+name\s+of\s+payee\b/iu.test(line);
}

function hasPayorDeclarationContext(lines: string[], labelIndex: number) {
  return /\b(?:we\s+declare\s+under\s+the\s+penalties\s+of\s+perjury|national\s+internal\s+revenue\s+code|data\s+privacy\s+act)\b/iu.test(
    lines.slice(0, labelIndex).join("\n"),
  );
}

function cleanSignerComponent(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/\([^)]*\)/gu, " ")
    .replace(/\b(?:TIN|Tel|Telephone)\s*[:#-]?\s*[\d\s-]+$/iu, "")
    .replace(/\s+/gu, " ")
    .replace(/^[\s:|/,-]+|[\s:|/,-]+$/gu, "")
    .trim();

  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

function isSignerNoiseLine(line: string): boolean {
  return /\b(?:bir\s+form|certificate\s+of\s+creditable|signature\s+over\s+printed\s+name|authorized\s+representative|tax\s+agent\s+accreditation|attorney'?s\s+roll|date\s+of\s+(?:issue|expiry)|conforme|data\s+privacy|national\s+internal\s+revenue\s+code|penalties\s+of\s+perjury|certificate\s+has\s+been\s+made|indicate\s+title|total)\b/iu.test(
    line,
  );
}

function isCompanyLikeSignerLine(line: string): boolean {
  return /\b(?:inc\.?|corp(?:oration)?|company|cooperative|electric|solutions|therma|first\s+gen)\b/iu.test(
    line,
  );
}

function isTitleLikeSignerLine(line: string): boolean {
  return /\b(?:manager|management|head|tax|accounting|finance|controller|chief|realty|contract|officer|treasurer|president)\b/iu.test(
    line,
  );
}

function isUsableSignerName(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  if (
    isSignerNoiseLine(value) ||
    isCompanyLikeSignerLine(value) ||
    isTitleLikeSignerLine(value)
  ) {
    return false;
  }

  const words = value.match(/\p{L}[\p{L}.'-]*/gu) ?? [];
  const substantialWords = words.filter(
    (word) => word.replace(/[.'-]/gu, "").length > 1,
  );

  return words.length >= 2 && substantialWords.length >= 2;
}

function isUsableSignerTitle(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  return (
    !isSignerNoiseLine(value) &&
    !/^\s*(?:tin|tel|telephone)\b/iu.test(value) &&
    /\p{L}/u.test(value)
  );
}

function normalizeSignerTin(value: string | undefined): string | undefined {
  const digits = normalizeTinDigits(value);
  return digits && CANONICAL_TIN_LENGTHS.has(digits.length)
    ? digits
    : undefined;
}

function extractExplicitSignerTin(line: string): string | undefined {
  if (/^\s*(?:tel|telephone)\b/iu.test(line)) {
    return undefined;
  }

  return /\btin\b/iu.test(line) ? normalizeSignerTin(line) : undefined;
}

function parseSlashSignerLine(
  line: string,
): Omit<RecoveredSignerFields, "label" | "sourceLine"> | undefined {
  const parts = line
    .split(/\s+\/\s+/u)
    .map(cleanSignerComponent)
    .filter((part): part is string => Boolean(part));
  if (parts.length < 2) {
    return undefined;
  }

  const printedName = parts[0];
  if (!isUsableSignerName(printedName)) {
    return undefined;
  }

  const signatoryTitle = isUsableSignerTitle(parts[1]) ? parts[1] : undefined;
  const signatoryTin = normalizeSignerTin(parts[2]);

  return {
    printedName,
    signatoryTitle,
    signatoryTin,
  };
}

function parseMultilineSignerLines(
  lines: string[],
): Omit<RecoveredSignerFields, "label" | "sourceLine"> | undefined {
  const nameIndex = lines.findIndex((line) =>
    isUsableSignerName(cleanSignerComponent(line)),
  );
  if (nameIndex < 0) {
    return undefined;
  }

  const printedName = cleanSignerComponent(lines[nameIndex]);
  if (!printedName) {
    return undefined;
  }

  const trailingLines = lines.slice(nameIndex + 1);
  const signatoryTin = extractFirstEvidenceValue(trailingLines, (line) =>
    extractExplicitSignerTin(line),
  );
  const titleLine = trailingLines.find((line) =>
    isUsableSignerTitle(cleanSignerComponent(line)),
  );
  const signatoryTitle = cleanSignerComponent(titleLine);

  return {
    printedName,
    signatoryTitle,
    signatoryTin,
  };
}

function parseSignerCandidateLines(
  lines: string[],
): Omit<RecoveredSignerFields, "label" | "sourceLine"> | undefined {
  for (const line of lines) {
    const parsed = parseSlashSignerLine(line);
    if (parsed) {
      return parsed;
    }
  }

  return parseMultilineSignerLines(lines);
}

function recoverSignerTextFallback(input: {
  normalized: Record<string, unknown>;
  ocrText: string;
  signatureVisualDetection?: SignatureVisualSignerRecoveryEvidence;
}): SignerTextFallbackResult | undefined {
  const visualReason = getSignerRecoveryVisualReason(
    input.signatureVisualDetection,
  );
  if (
    !visualReason ||
    !hasBir2307SignerRecoveryContext({
      normalized: input.normalized,
      ocrText: input.ocrText,
    })
  ) {
    return undefined;
  }

  const sectionText = getPayorSignatureEvidenceText(input.ocrText);
  const lines = normalizeSignerEvidenceLines(sectionText);
  const labelIndex = lines.findIndex((line, index) => {
    if (isPayorSignatureLabel(line)) {
      return true;
    }

    return (
      isPayeeSignatureLabel(line) && hasPayorDeclarationContext(lines, index)
    );
  });

  const auditBase = {
    source: "ocr_pre_conforme" as const,
    visualStatus: input.signatureVisualDetection?.status,
    visualReason,
  };

  if (labelIndex < 0) {
    return {
      audit: {
        ...auditBase,
        status: "not_found",
        reason: "signature_label_missing",
      },
    };
  }

  const candidateLines = lines
    .slice(Math.max(0, labelIndex - 5), labelIndex)
    .filter((line) => !isSignerNoiseLine(line));
  const parsed = parseSignerCandidateLines(candidateLines);
  if (!parsed) {
    return {
      audit: {
        ...auditBase,
        status: "not_found",
        reason: "no_valid_pre_conforme_signer",
      },
    };
  }

  const label: RecoveredSignerFields["label"] = isPayorSignatureLabel(
    lines[labelIndex],
  )
    ? "payor"
    : "payee_mislabeled";
  const sourceLine = candidateLines.join(" / ");
  const recoveredFields = [
    "printedName",
    parsed.signatoryTitle ? "signatoryTitle" : undefined,
    parsed.signatoryTin ? "signatoryTin" : undefined,
  ].filter((field): field is string => Boolean(field));
  const fields: RecoveredSignerFields = {
    ...parsed,
    label,
    sourceLine,
  };

  return {
    fields,
    audit: {
      ...auditBase,
      status: "recovered",
      label,
      recoveredFields,
      sourceLine,
    },
  };
}

function normalizeSignaturePresent(input: {
  value: unknown;
  ocrText: string;
}): boolean | undefined {
  const parsed = toBooleanOrUndefined(input.value);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed === false && !hasVisiblePayorSignatureBlock(input.ocrText)) {
    return undefined;
  }

  return parsed;
}

export function postProcessNormalizedFields(
  input: NormalizerPostProcessInput,
): NormalizedResult {
  const normalized = input.normalized;
  const ocrText = buildNormalizerOcrText({
    extraction: input.extraction,
    annotationRaw: input.annotationRaw,
  });
  const partyEvidenceTexts = getPartyEvidenceTexts({
    extraction: input.extraction,
    annotationRaw: input.annotationRaw,
  });
  const periodEvidenceTexts = getPeriodEvidenceTexts({
    extraction: input.extraction,
    annotationRaw: input.annotationRaw,
  });
  const partyEvidence = extractBir2307PartyEvidence(partyEvidenceTexts);
  const periodEvidence = extractBir2307PeriodEvidence(
    periodEvidenceTexts,
    input.audit.startedAt,
  );
  const confidenceMap = sanitizeConfidenceMap(
    normalized.confidences ?? normalized.confidenceMap,
  );
  const taxBase = parseMoney(normalized.taxBase);
  const taxWithheld = parseMoney(normalized.taxWithheld);
  const atcCode = toStringOrUndefined(normalized.atcCode);
  let periodStart = normalizePeriodStartValue(
    periodEvidence?.periodStart ??
      normalized.periodStart ??
      normalized.periodCovered,
  );
  let periodEnd = normalizePeriodEndValue(
    periodEvidence?.periodEnd ??
      normalized.periodEnd ??
      normalized.periodCovered,
  );
  const normalizedPeriodCovered = normalizePeriodCoveredValue(
    periodEvidence?.periodCovered ?? normalized.periodCovered,
  );
  let periodCovered =
    (normalizedPeriodCovered?.includes(" to ")
      ? normalizedPeriodCovered
      : undefined) ??
    buildPeriodCoveredValue(periodStart, periodEnd) ??
    normalizedPeriodCovered;
  const periodRangeIssue = getBir2307PeriodRangeIssue({
    periodStart,
    periodEnd,
    auditStartedAt: input.audit.startedAt,
  });
  if (periodRangeIssue) {
    periodStart = undefined;
    periodEnd = undefined;
    periodCovered = undefined;
  }
  const inferredMonthOfQuarter = inferMonthOfQuarterFromTaxBasePlacement({
    atcCode,
    ocrText,
    taxBase,
  });
  const monthOfQuarter =
    inferredMonthOfQuarter.kind === "month"
      ? inferredMonthOfQuarter.value
      : inferredMonthOfQuarter.kind === "clear"
        ? undefined
        : toMonthOfQuarterOrUndefined(normalized.monthOfQuarter);
  const payeeName =
    partyEvidence.payee.name ?? toStringOrUndefined(normalized.payeeName);
  const payeeTin = toPartyTinStringOrUndefined(
    normalized.payeeTin,
    "payeeTin",
    partyEvidenceTexts,
  );
  const payeeAddress =
    partyEvidence.payee.address ?? toStringOrUndefined(normalized.payeeAddress);
  const payeeZip =
    partyEvidence.payee.zip ?? toStringOrUndefined(normalized.payeeZip);
  const payorName =
    partyEvidence.payor.name ?? toStringOrUndefined(normalized.payorName);
  const payorTin = toPartyTinStringOrUndefined(
    normalized.payorTin,
    "payorTin",
    partyEvidenceTexts,
  );
  const payorAddress =
    partyEvidence.payor.address ?? toStringOrUndefined(normalized.payorAddress);
  const payorZip =
    partyEvidence.payor.zip ?? toStringOrUndefined(normalized.payorZip);
  const trustedPrintedName = trustedSignerStringFromAnnotation(
    normalized.printedName,
    confidenceMap?.printedName,
  );
  const signerTextFallback = trustedPrintedName
    ? undefined
    : recoverSignerTextFallback({
        normalized,
        ocrText,
        signatureVisualDetection: input.signatureVisualDetection,
      });
  const trustedSignatoryTitle = trustedSignerStringFromAnnotation(
    normalized.signatoryTitle,
    confidenceMap?.signatoryTitle,
  );
  const trustedSignatoryTin = trustedSignerTinFromAnnotation(
    normalized.signatoryTin,
    confidenceMap?.signatoryTin,
  );
  const printedName =
    trustedPrintedName ?? signerTextFallback?.fields?.printedName;
  const signatoryTitle =
    trustedSignatoryTitle ?? signerTextFallback?.fields?.signatoryTitle;
  const signatoryTin =
    trustedSignatoryTin ?? signerTextFallback?.fields?.signatoryTin;
  const signaturePresent = normalizeSignaturePresent({
    value: normalized.signaturePresent,
    ocrText,
  });
  const signatureText = toStringOrUndefined(normalized.signatureText);
  const companyName = toStringOrUndefined(normalized.companyName);
  const isBir2307 = toBooleanOrUndefined(normalized.isBir2307);
  const annotationWarnings = appendWarning(
    sanitizeWarnings(normalized.warnings),
    periodRangeIssue
      ? `period evidence rejected: ${periodRangeIssue}`
      : undefined,
  );
  const legacySignature = normalized.signature;

  return {
    fields: {
      isBir2307,
      periodStart,
      periodCovered,
      periodEnd,
      monthOfQuarter,
      payeeName,
      payeeTin,
      payeeAddress,
      payeeZip,
      payorName,
      payorTin,
      payorAddress,
      payorZip,
      atcCode,
      taxBase: Number.isFinite(taxBase) ? taxBase : undefined,
      taxWithheld: Number.isFinite(taxWithheld) ? taxWithheld : undefined,
      printedName,
      signatoryTitle,
      signatoryTin,
      signaturePresent,
      signatureText,
      signature:
        signaturePresent ??
        toBooleanOrUndefined(legacySignature) ??
        toStringOrUndefined(legacySignature),
      companyName,
      annotationWarnings,
      confidenceMap,
      normalizedFrom: "mistral-document-annotation",
      normalizedAt: new Date().toISOString(),
      normalizerElapsedMs: input.audit.elapsedMs,
      normalizerPayload: {
        payloadSchemaVersion: NORMALIZER_PROMPT_SCHEMA_VERSION,
        sourceFileId: input.audit.sourceFileId,
        revision: input.audit.revision,
        normalizerProvider: input.audit.provider,
        normalizerDeployment: input.audit.model,
        normalizerResponseModel: input.audit.responseModel,
        normalizerResponseFormat: "document_annotation_json_schema",
        normalizerResponseSchemaName: NORMALIZER_RESPONSE_SCHEMA_NAME,
        normalizerResponseSchemaVersion: NORMALIZER_RESPONSE_SCHEMA_VERSION,
        normalizerRequestPayloadChars: input.audit.requestPayloadChars,
        normalizerAnnotationPayloadChars: input.audit.annotationPayloadChars,
        normalizerUsageInfo: input.audit.usageInfo,
        zoneFallbackStatus: getMetadataStatus(input.extraction.metadata),
        zoneFallbackBlockCount: getZoneFallbackBlocks(input.extraction.raw)
          .length,
        ...(signerTextFallback
          ? { signerTextFallback: signerTextFallback.audit }
          : {}),
      },
    },
  };
}
