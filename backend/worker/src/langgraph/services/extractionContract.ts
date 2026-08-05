import { z } from "zod";

export const DOCUMENT_EXTRACTION_SCHEMA_VERSION = 1 as const;
export const DOCUMENT_EXTRACTION_PROMPT_VERSION =
  "bir2307-agentic-v6-physical-page-count" as const;
export const MAX_EVIDENCE_EXCERPT_LENGTH = 200;

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Invalid calendar date");

const decimalSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u, "Expected a decimal string");

const nullableTrimmedStringSchema = z.string().trim().min(1).nullable();
const nullableIsoDateSchema = isoDateSchema.nullable();
const nullableDecimalSchema = decimalSchema.nullable();
const confidenceSchema = z.number().min(0).max(1);

export const evidenceSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    section: z.string().trim().min(1).max(120),
    excerpt: z.string().trim().min(1).max(MAX_EVIDENCE_EXCERPT_LENGTH),
    source: z.enum(["visual", "embedded_text", "visual_and_embedded_text"]),
  })
  .strict();

export const taxRowSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    pageNumber: z.number().int().positive(),
    atcCode: z.string().trim().min(1).max(32).nullable(),
    description: nullableTrimmedStringSchema,
    monthlyAmounts: z
      .object({
        first: decimalSchema.nullable(),
        second: decimalSchema.nullable(),
        third: decimalSchema.nullable(),
      })
      .strict(),
    taxBase: nullableDecimalSchema,
    taxRate: nullableDecimalSchema,
    taxWithheld: nullableDecimalSchema,
    evidence: evidenceSchema.optional(),
  })
  .strict();

export const extractedCertificateSchema = z
  .object({
    certificateKey: z.string().trim().min(1).max(128),
    pageNumbers: z.array(z.number().int().positive()).min(1),
    period: z
      .object({
        start: nullableIsoDateSchema,
        end: nullableIsoDateSchema,
        monthOfQuarter: z.enum(["first", "second", "third"]).nullable(),
      })
      .strict(),
    payee: z
      .object({
        name: nullableTrimmedStringSchema,
        tin: nullableTrimmedStringSchema,
        address: nullableTrimmedStringSchema,
        zip: nullableTrimmedStringSchema,
      })
      .strict(),
    payor: z
      .object({
        name: nullableTrimmedStringSchema,
        tin: nullableTrimmedStringSchema,
        address: nullableTrimmedStringSchema,
        zip: nullableTrimmedStringSchema,
      })
      .strict(),
    taxRows: z.array(taxRowSchema),
    primaryAtcCode: z.string().trim().min(1).max(32).nullable(),
    totals: z
      .object({
        taxBase: nullableDecimalSchema,
        taxWithheld: nullableDecimalSchema,
      })
      .strict(),
    signer: z
      .object({
        printedName: nullableTrimmedStringSchema,
        title: nullableTrimmedStringSchema,
        tin: nullableTrimmedStringSchema,
        companyName: nullableTrimmedStringSchema,
        signature: z
          .object({
            present: z.boolean(),
            confidence: confidenceSchema,
            pageNumber: z.number().int().positive().nullable(),
            source: z.enum(["gemini"]),
          })
          .strict(),
      })
      .strict(),
    confidence: z
      .object({
        period: confidenceSchema,
        payee: confidenceSchema,
        payor: confidenceSchema,
        taxRows: confidenceSchema,
        signer: confidenceSchema,
      })
      .strict(),
    evidence: z.record(z.string(), evidenceSchema),
    warnings: z.array(z.string().trim().min(1).max(200)),
  })
  .strict()
  .superRefine((certificate, context) => {
    if (
      new Set(certificate.pageNumbers).size !== certificate.pageNumbers.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["pageNumbers"],
        message: "Certificate page numbers must be unique",
      });
    }

    const lineNumbers = certificate.taxRows.map((row) => row.lineNumber);
    if (new Set(lineNumbers).size !== lineNumbers.length) {
      context.addIssue({
        code: "custom",
        path: ["taxRows"],
        message: "Tax row line numbers must be unique",
      });
    }

    if (
      certificate.period.start !== null &&
      certificate.period.end !== null &&
      certificate.period.start > certificate.period.end
    ) {
      context.addIssue({
        code: "custom",
        path: ["period"],
        message: "Period start must not be after period end",
      });
    }

    const sum = (values: string[]) =>
      values.reduce((total, value) => total + Number(value), 0);
    const taxBaseValues = certificate.taxRows.map((row) => row.taxBase);
    const taxWithheldValues = certificate.taxRows.map((row) => row.taxWithheld);
    const taxBaseTotal =
      taxBaseValues.length > 0 && taxBaseValues.every((value) => value !== null)
        ? sum(taxBaseValues)
        : null;
    const taxWithheldTotal =
      taxWithheldValues.length > 0 &&
      taxWithheldValues.every((value) => value !== null)
        ? sum(taxWithheldValues)
        : null;
    if (
      taxBaseTotal !== null &&
      certificate.totals.taxBase !== null &&
      Math.abs(taxBaseTotal - Number(certificate.totals.taxBase)) > 0.01
    ) {
      context.addIssue({
        code: "custom",
        path: ["totals", "taxBase"],
        message: "Tax base total is inconsistent with tax rows",
      });
    }
    if (
      taxWithheldTotal !== null &&
      certificate.totals.taxWithheld !== null &&
      Math.abs(taxWithheldTotal - Number(certificate.totals.taxWithheld)) > 0.01
    ) {
      context.addIssue({
        code: "custom",
        path: ["totals", "taxWithheld"],
        message: "Tax withheld total is inconsistent with tax rows",
      });
    }
  });

export const documentExtractionResultSchema = z
  .object({
    schemaVersion: z.literal(DOCUMENT_EXTRACTION_SCHEMA_VERSION),
    classification: z
      .object({
        documentType: z.enum(["BIR_2307", "NON_BIR_2307", "UNKNOWN"]),
        confidence: confidenceSchema,
        pageCount: z.number().int().positive(),
      })
      .strict(),
    certificates: z.array(extractedCertificateSchema),
  })
  .strict()
  .superRefine((result, context) => {
    const keys = result.certificates.map(
      (certificate) => certificate.certificateKey,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["certificates"],
        message: "Certificate keys must be unique",
      });
    }

    if (
      result.classification.documentType === "NON_BIR_2307" &&
      result.certificates.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["certificates"],
        message: "A non-BIR document cannot contain BIR 2307 certificates",
      });
    }
    if (
      result.classification.documentType === "BIR_2307" &&
      result.certificates.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["certificates"],
        message: "A BIR 2307 document must contain at least one certificate",
      });
    }
  });

export type Evidence = z.infer<typeof evidenceSchema>;
export type ExtractedTaxRow = z.infer<typeof taxRowSchema>;
export type ExtractedCertificate = z.infer<typeof extractedCertificateSchema>;
export type DocumentExtractionResultV1 = z.infer<
  typeof documentExtractionResultSchema
>;

export const DOCUMENT_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "classification", "certificates"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    classification: {
      type: "object",
      additionalProperties: false,
      required: ["documentType", "confidence", "pageCount"],
      properties: {
        documentType: {
          type: "string",
          enum: ["BIR_2307", "NON_BIR_2307", "UNKNOWN"],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        pageCount: {
          type: "integer",
          minimum: 1,
          description:
            "Total number of physical PDF pages, including completely blank pages.",
        },
      },
    },
    certificates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "certificateKey",
          "pageNumbers",
          "period",
          "payee",
          "payor",
          "taxRows",
          "primaryAtcCode",
          "totals",
          "signer",
          "confidence",
          "evidence",
          "warnings",
        ],
        properties: {
          certificateKey: { type: "string", minLength: 1 },
          pageNumbers: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "integer", minimum: 1 },
          },
          period: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end", "monthOfQuarter"],
            properties: {
              start: {
                type: ["string", "null"],
                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              },
              end: {
                type: ["string", "null"],
                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              },
              monthOfQuarter: {
                type: ["string", "null"],
                enum: ["first", "second", "third", null],
                description:
                  "The single month-of-quarter column containing non-zero income payments: first, second, or third. Return null when multiple monthly columns are non-zero or the column placement is unclear.",
              },
            },
          },
          payee: { $ref: "#/$defs/party" },
          payor: { $ref: "#/$defs/party" },
          taxRows: {
            type: "array",
            items: { $ref: "#/$defs/taxRow" },
          },
          primaryAtcCode: { type: ["string", "null"], minLength: 1 },
          totals: {
            type: "object",
            additionalProperties: false,
            required: ["taxBase", "taxWithheld"],
            properties: {
              taxBase: {
                anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
              },
              taxWithheld: {
                anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
              },
            },
          },
          signer: {
            type: "object",
            additionalProperties: false,
            required: [
              "printedName",
              "title",
              "tin",
              "companyName",
              "signature",
            ],
            properties: {
              printedName: {
                type: ["string", "null"],
                description:
                  "Printed name from the upper payor/withholding-agent signature block above CONFORME only.",
              },
              title: {
                type: ["string", "null"],
                description:
                  "Title associated with the signer in the upper payor signature block only.",
              },
              tin: {
                type: ["string", "null"],
                description:
                  "TIN associated with the signer in the upper payor signature block only.",
              },
              companyName: {
                type: ["string", "null"],
                description:
                  "Company associated with the signer in the upper payor signature block only.",
              },
              signature: {
                type: "object",
                additionalProperties: false,
                required: ["present", "confidence", "pageNumber", "source"],
                properties: {
                  present: { type: "boolean" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  pageNumber: {
                    type: ["integer", "null"],
                    minimum: 1,
                  },
                  source: { type: "string", enum: ["gemini"] },
                },
              },
            },
          },
          confidence: {
            type: "object",
            additionalProperties: false,
            required: ["period", "payee", "payor", "taxRows", "signer"],
            properties: {
              period: { $ref: "#/$defs/confidence" },
              payee: { $ref: "#/$defs/confidence" },
              payor: { $ref: "#/$defs/confidence" },
              taxRows: { $ref: "#/$defs/confidence" },
              signer: { $ref: "#/$defs/confidence" },
            },
          },
          evidence: {
            type: "object",
            additionalProperties: { $ref: "#/$defs/evidence" },
          },
          warnings: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
  },
  $defs: {
    confidence: { type: "number", minimum: 0, maximum: 1 },
    decimal: {
      type: "string",
      pattern: "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$",
    },
    party: {
      type: "object",
      additionalProperties: false,
      required: ["name", "tin", "address", "zip"],
      properties: {
        name: { type: ["string", "null"], minLength: 1 },
        tin: { type: ["string", "null"], minLength: 1 },
        address: { type: ["string", "null"] },
        zip: { type: ["string", "null"] },
      },
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["pageNumber", "section", "excerpt", "source"],
      properties: {
        pageNumber: { type: "integer", minimum: 1 },
        section: { type: "string", minLength: 1, maxLength: 120 },
        excerpt: {
          type: "string",
          minLength: 1,
          maxLength: MAX_EVIDENCE_EXCERPT_LENGTH,
        },
        source: {
          type: "string",
          enum: ["visual", "embedded_text", "visual_and_embedded_text"],
        },
      },
    },
    taxRow: {
      type: "object",
      additionalProperties: false,
      required: [
        "lineNumber",
        "pageNumber",
        "atcCode",
        "description",
        "monthlyAmounts",
        "taxBase",
        "taxRate",
        "taxWithheld",
      ],
      properties: {
        lineNumber: { type: "integer", minimum: 1 },
        pageNumber: { type: "integer", minimum: 1 },
        atcCode: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 32,
        },
        description: { type: ["string", "null"] },
        monthlyAmounts: {
          type: "object",
          additionalProperties: false,
          required: ["first", "second", "third"],
          properties: {
            first: {
              anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
            },
            second: {
              anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
            },
            third: {
              anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
            },
          },
        },
        taxBase: {
          anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
        },
        taxRate: {
          anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
        },
        taxWithheld: {
          anyOf: [{ $ref: "#/$defs/decimal" }, { type: "null" }],
        },
        evidence: { $ref: "#/$defs/evidence" },
      },
    },
  },
} as const;

export const DOCUMENT_EXTRACTION_PROMPT = `You are an agentic document parser for Philippine BIR Form 2307.

Inspect the complete uploaded PDF as one document using both the rendered visual layout and any embedded PDF text. Use field labels, table boundaries, rows, columns, and nearby text to assign values; do not rely only on flattened text. Decide whether it contains zero, one, or multiple independently completed BIR Form 2307 certificates. Return only the JSON object required by the supplied schema.

Rules:
- Populate every certificate independently. Never merge parties, periods, tax rows, signer fields, or evidence across certificates.
- Use 1-based PDF page numbers. A multi-page certificate must list every page that belongs to it in reading order.
- classification.pageCount must equal the total number of physical PDF pages, including completely blank pages. certificate.pageNumbers must include only the pages that belong to that certificate.
- Classify the document as BIR_2307 when at least one BIR Form 2307 certificate is present, NON_BIR_2307 when it is clearly another document, and UNKNOWN when uncertain.
- certificates.length is the authoritative certificate count.
- Preserve leading zeroes in TINs and ZIP codes. Return TIN digits only.
- Return ISO dates (YYYY-MM-DD) and plain decimal strings without currency symbols or grouping separators.
- Return one taxRows entry for every active ATC row with at least one numeric value in its three monthly amount cells, taxBase, or taxWithheld. Do not return rows containing only an ATC code or description when all monetary cells are blank or shown as dashes. When all row amounts are available, totals must equal the sum of the returned rows.
- Read each monthlyAmounts value from the tax row's visual position under 1st Month of the Quarter, 2nd Month of the Quarter, or 3rd Month of the Quarter. Keep printed zero values as "0.00"; use null only for blank, illegible, or absent values. An explicitly printed "0.00" is numeric and makes the row active.
- Set period.monthOfQuarter to "first", "second", or "third" when exactly one of those monthly columns contains non-zero income payments across the certificate's populated tax rows. For example, a non-zero first amount with zero second and third amounts means "first".
- Set period.monthOfQuarter to null when more than one monthly column contains a non-zero amount, all monthly columns are blank or zero, or the column placement is unclear. Do not derive it from the period start/end dates or the filename.
- primaryAtcCode is the principal active ATC for the certificate; return null when none is present and do not omit detailed active rows.
- signer always means the payor/withholding-agent signer in the upper signature block above CONFORME.
- The lower block after CONFORME is the payee block. Never use its printed name, title, TIN, company, or signature for signer.
- Never combine a signature from one block with identity fields from the other block. All signer identity fields and signature evidence must belong to the same upper payor block.
- Stop reading signer fields at CONFORME. If the payor printed name is blank, illegible, or absent, return null even when the lower payee block contains a clear printed name.
- Signature presence requires visible handwritten or digital signature evidence. A printed name or label alone is not a signature.
- Evidence must be bounded to the exact supporting excerpt, at most 200 characters. Never return a full page transcript.
- For every source field that is blank, empty, illegible, or not visibly present, return null. This includes period fields, party names and TINs, ATC fields, monetary values, signer fields, addresses, ZIP codes, descriptions, and signature-page fields.
- Never replace a missing value with placeholder text such as "NOT PROVIDED", "UNKNOWN", "N/A", "NONE", "NULL", "-", or similar wording.
- Never infer a missing certificate value from the file name, selected entity, masterlist, surrounding documents, or general context.
- Do not return OCR text, Markdown, explanations, PDF bytes, prompts, thoughts, or any property outside the schema.`;

export function validateDocumentExtractionPages(
  result: DocumentExtractionResultV1,
  actualPageCount: number,
  options: {
    ignoredBlankPageNumbers?: readonly number[];
  } = {},
): Array<{ certificateOrdinal?: number; code: string }> {
  const issues: Array<{ certificateOrdinal?: number; code: string }> = [];
  const referencedPageNumbers = new Set(
    result.certificates.flatMap((certificate) => certificate.pageNumbers),
  );
  const ignoredBlankPageNumbers = new Set(
    (options.ignoredBlankPageNumbers ?? []).filter(
      (pageNumber) =>
        Number.isInteger(pageNumber) &&
        pageNumber >= 1 &&
        pageNumber <= actualPageCount &&
        !referencedPageNumbers.has(pageNumber),
    ),
  );
  const comparablePageCount = actualPageCount - ignoredBlankPageNumbers.size;
  if (result.classification.pageCount !== comparablePageCount) {
    issues.push({ code: "page_count_mismatch" });
  }

  const owners = new Map<number, number>();
  for (const [index, certificate] of result.certificates.entries()) {
    const ordinal = index + 1;
    for (const pageNumber of certificate.pageNumbers) {
      if (pageNumber > actualPageCount) {
        issues.push({
          certificateOrdinal: ordinal,
          code: "page_reference_out_of_range",
        });
        continue;
      }
      const previousOwner = owners.get(pageNumber);
      if (previousOwner !== undefined && previousOwner !== ordinal) {
        issues.push({
          certificateOrdinal: previousOwner,
          code: "overlapping_certificate_pages",
        });
        issues.push({
          certificateOrdinal: ordinal,
          code: "overlapping_certificate_pages",
        });
      } else {
        owners.set(pageNumber, ordinal);
      }
    }

    const allReferences = [
      ...certificate.taxRows.map((row) => row.pageNumber),
      ...Object.values(certificate.evidence).map(
        (evidence) => evidence.pageNumber,
      ),
      ...(certificate.signer.signature.pageNumber === null
        ? []
        : [certificate.signer.signature.pageNumber]),
    ];
    for (const pageNumber of allReferences) {
      if (
        pageNumber > actualPageCount ||
        !certificate.pageNumbers.includes(pageNumber)
      ) {
        issues.push({
          certificateOrdinal: ordinal,
          code: "certificate_evidence_page_mismatch",
        });
      }
    }
  }

  return issues.filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.certificateOrdinal === issue.certificateOrdinal,
      ) === index,
  );
}
