import { z } from "zod";

export const DOCUMENT_EXTRACTION_SCHEMA_VERSION = 3 as const;
export const DOCUMENT_EXTRACTION_PROMPT_VERSION =
  "bir2307-agentic-v10-identity-visibility" as const;
export const MAX_EVIDENCE_EXCERPT_LENGTH = 200;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const decimalSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u, "Expected a decimal string");

const nullableTrimmedStringSchema = z.string().trim().min(1).nullable();
const nullableIsoDateSchema = isoDateSchema.nullable();
const nullableDecimalSchema = decimalSchema.nullable();
const confidenceSchema = z.number().min(0).max(1);
const identityFieldVisibilityValueSchema = z.enum([
  "readable",
  "blank",
  "unreadable",
]);

const identityFieldVisibilitySchema = z
  .object({
    payee: z
      .object({
        name: identityFieldVisibilityValueSchema,
        tin: identityFieldVisibilityValueSchema,
      })
      .strict(),
    payor: z
      .object({
        name: identityFieldVisibilityValueSchema,
        tin: identityFieldVisibilityValueSchema,
      })
      .strict(),
  })
  .strict();

const partyFieldConfidenceSchema = z
  .object({
    name: confidenceSchema,
    tin: confidenceSchema,
    address: confidenceSchema,
    zip: confidenceSchema,
  })
  .strict();

const taxRowFieldConfidenceSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    atcCode: confidenceSchema,
    description: confidenceSchema,
    monthlyAmounts: z
      .object({
        first: confidenceSchema,
        second: confidenceSchema,
        third: confidenceSchema,
      })
      .strict(),
    taxBase: confidenceSchema,
    taxRate: confidenceSchema,
    taxWithheld: confidenceSchema,
  })
  .strict();

const fieldConfidenceSchema = z
  .object({
    period: z
      .object({
        start: confidenceSchema,
        end: confidenceSchema,
        monthOfQuarter: confidenceSchema,
      })
      .strict(),
    payee: partyFieldConfidenceSchema,
    payor: partyFieldConfidenceSchema,
    taxRows: z.array(taxRowFieldConfidenceSchema),
    primaryAtcCode: confidenceSchema,
    totals: z
      .object({
        taxBase: confidenceSchema,
        taxWithheld: confidenceSchema,
      })
      .strict(),
    signer: z
      .object({
        printedName: confidenceSchema,
        title: confidenceSchema,
        tin: confidenceSchema,
        companyName: confidenceSchema,
      })
      .strict(),
  })
  .strict();

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
    fieldConfidence: fieldConfidenceSchema,
    identityFieldVisibility: identityFieldVisibilitySchema,
    evidence: z.record(z.string(), evidenceSchema),
    warnings: z.array(z.string().trim().min(1).max(200)),
  })
  .strict()
  .superRefine((certificate, context) => {
    const requireZeroForNull = (
      value: unknown,
      confidence: number,
      path: PropertyKey[],
    ) => {
      if (value === null && confidence !== 0) {
        context.addIssue({
          code: "custom",
          path: ["fieldConfidence", ...path],
          message: "Confidence must be zero when the extracted value is null",
        });
      }
    };

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

    requireZeroForNull(
      certificate.period.start,
      certificate.fieldConfidence.period.start,
      ["period", "start"],
    );
    requireZeroForNull(
      certificate.period.end,
      certificate.fieldConfidence.period.end,
      ["period", "end"],
    );
    requireZeroForNull(
      certificate.period.monthOfQuarter,
      certificate.fieldConfidence.period.monthOfQuarter,
      ["period", "monthOfQuarter"],
    );

    for (const party of ["payee", "payor"] as const) {
      for (const field of ["name", "tin", "address", "zip"] as const) {
        requireZeroForNull(
          certificate[party][field],
          certificate.fieldConfidence[party][field],
          [party, field],
        );
      }
    }

    for (const party of ["payee", "payor"] as const) {
      for (const field of ["name", "tin"] as const) {
        const value = certificate[party][field];
        const visibility = certificate.identityFieldVisibility[party][field];
        if (visibility === "readable" && value === null) {
          context.addIssue({
            code: "custom",
            path: ["identityFieldVisibility", party, field],
            message: "A readable identity field must have a non-null value",
          });
        }
        if (visibility !== "readable" && value !== null) {
          context.addIssue({
            code: "custom",
            path: ["identityFieldVisibility", party, field],
            message:
              "A blank or unreadable identity field must have a null value",
          });
        }
      }
    }

    if (
      certificate.taxRows.length !== certificate.fieldConfidence.taxRows.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["fieldConfidence", "taxRows"],
        message:
          "Tax-row confidence entries must match the extracted tax-row count",
      });
    } else {
      certificate.taxRows.forEach((row, index) => {
        const confidence = certificate.fieldConfidence.taxRows[index]!;
        if (confidence.lineNumber !== row.lineNumber) {
          context.addIssue({
            code: "custom",
            path: ["fieldConfidence", "taxRows", index, "lineNumber"],
            message:
              "Tax-row confidence lineNumber must match the extracted tax row",
          });
        }
        requireZeroForNull(row.atcCode, confidence.atcCode, [
          "taxRows",
          index,
          "atcCode",
        ]);
        requireZeroForNull(row.description, confidence.description, [
          "taxRows",
          index,
          "description",
        ]);
        for (const month of ["first", "second", "third"] as const) {
          requireZeroForNull(
            row.monthlyAmounts[month],
            confidence.monthlyAmounts[month],
            ["taxRows", index, "monthlyAmounts", month],
          );
        }
        for (const field of ["taxBase", "taxRate", "taxWithheld"] as const) {
          requireZeroForNull(row[field], confidence[field], [
            "taxRows",
            index,
            field,
          ]);
        }
      });
    }

    requireZeroForNull(
      certificate.primaryAtcCode,
      certificate.fieldConfidence.primaryAtcCode,
      ["primaryAtcCode"],
    );
    for (const field of ["taxBase", "taxWithheld"] as const) {
      requireZeroForNull(
        certificate.totals[field],
        certificate.fieldConfidence.totals[field],
        ["totals", field],
      );
    }
    for (const field of [
      "printedName",
      "title",
      "tin",
      "companyName",
    ] as const) {
      requireZeroForNull(
        certificate.signer[field],
        certificate.fieldConfidence.signer[field],
        ["signer", field],
      );
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
export type DocumentExtractionResultV3 = z.infer<
  typeof documentExtractionResultSchema
>;
/** @deprecated New Gemini responses use schema v3. */
export type DocumentExtractionResultV2 = DocumentExtractionResultV3;

export const DOCUMENT_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "classification", "certificates"],
  properties: {
    schemaVersion: { type: "integer", enum: [3] },
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
          "fieldConfidence",
          "identityFieldVisibility",
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
          fieldConfidence: { $ref: "#/$defs/fieldConfidence" },
          identityFieldVisibility: {
            $ref: "#/$defs/identityFieldVisibility",
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
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description:
        "Confidence that the corresponding value was read correctly from the visible form. Use 0 when the corresponding value is null.",
    },
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
    fieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "period",
        "payee",
        "payor",
        "taxRows",
        "primaryAtcCode",
        "totals",
        "signer",
      ],
      properties: {
        period: {
          type: "object",
          additionalProperties: false,
          required: ["start", "end", "monthOfQuarter"],
          properties: {
            start: { $ref: "#/$defs/confidence" },
            end: { $ref: "#/$defs/confidence" },
            monthOfQuarter: { $ref: "#/$defs/confidence" },
          },
        },
        payee: { $ref: "#/$defs/partyFieldConfidence" },
        payor: { $ref: "#/$defs/partyFieldConfidence" },
        taxRows: {
          type: "array",
          description:
            "One confidence entry per taxRows item, in the same order and with the same lineNumber.",
          items: { $ref: "#/$defs/taxRowFieldConfidence" },
        },
        primaryAtcCode: { $ref: "#/$defs/confidence" },
        totals: {
          type: "object",
          additionalProperties: false,
          required: ["taxBase", "taxWithheld"],
          properties: {
            taxBase: { $ref: "#/$defs/confidence" },
            taxWithheld: { $ref: "#/$defs/confidence" },
          },
        },
        signer: {
          type: "object",
          additionalProperties: false,
          required: ["printedName", "title", "tin", "companyName"],
          properties: {
            printedName: { $ref: "#/$defs/confidence" },
            title: { $ref: "#/$defs/confidence" },
            tin: { $ref: "#/$defs/confidence" },
            companyName: { $ref: "#/$defs/confidence" },
          },
        },
      },
    },
    identityFieldVisibility: {
      type: "object",
      additionalProperties: false,
      required: ["payee", "payor"],
      properties: {
        payee: { $ref: "#/$defs/identityPartyVisibility" },
        payor: { $ref: "#/$defs/identityPartyVisibility" },
      },
    },
    identityPartyVisibility: {
      type: "object",
      additionalProperties: false,
      required: ["name", "tin"],
      properties: {
        name: { $ref: "#/$defs/identityVisibility" },
        tin: { $ref: "#/$defs/identityVisibility" },
      },
    },
    identityVisibility: {
      type: "string",
      enum: ["readable", "blank", "unreadable"],
      description:
        "Whether the complete field has a visible value, is visibly empty, or may contain text that cannot be read reliably.",
    },
    partyFieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: ["name", "tin", "address", "zip"],
      properties: {
        name: { $ref: "#/$defs/confidence" },
        tin: { $ref: "#/$defs/confidence" },
        address: { $ref: "#/$defs/confidence" },
        zip: { $ref: "#/$defs/confidence" },
      },
    },
    taxRowFieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "lineNumber",
        "atcCode",
        "description",
        "monthlyAmounts",
        "taxBase",
        "taxRate",
        "taxWithheld",
      ],
      properties: {
        lineNumber: {
          type: "integer",
          minimum: 1,
          description:
            "The lineNumber of the corresponding taxRows item; this is an alignment key, not a confidence score.",
        },
        atcCode: { $ref: "#/$defs/confidence" },
        description: { $ref: "#/$defs/confidence" },
        monthlyAmounts: {
          type: "object",
          additionalProperties: false,
          required: ["first", "second", "third"],
          properties: {
            first: { $ref: "#/$defs/confidence" },
            second: { $ref: "#/$defs/confidence" },
            third: { $ref: "#/$defs/confidence" },
          },
        },
        taxBase: { $ref: "#/$defs/confidence" },
        taxRate: { $ref: "#/$defs/confidence" },
        taxWithheld: { $ref: "#/$defs/confidence" },
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
- Return one taxRows entry for every active ATC row with at least one numeric value in its three monthly amount cells, taxBase, or taxWithheld. Do not return rows containing only an ATC code or description when all monetary cells are blank or shown as dashes.
- When a description or ATC cell is visibly merged vertically across multiple active monetary subrows, repeat that shared printed description and ATC code in every corresponding taxRows entry. Preserve each monetary subrow separately and never combine or sum its monetary values.
- Never copy an ATC code from a prior row when the cells are separate, a row boundary excludes the code, or the shared scope is unclear. A genuinely blank, illegible, or absent ATC remains null.
- totals must contain only certificate-level totals explicitly printed on the form. Never calculate, combine, or infer totals from tax rows or separate form sections. When the form prints separate section totals without one certificate-level total, return null for that total field.
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
- Return fieldConfidence for every business form value. Each score is from 0 to 1 and measures only how certain you are that the corresponding value was read correctly from the visible form.
- Field confidence must never represent whether a value is plausible, correctly formatted, or consistent with a filename, masterlist, expected taxpayer, or outside context.
- When a corresponding extracted value is null, its field confidence must be 0. Otherwise score each field independently; do not copy one group score across all fields.
- Return identityFieldVisibility for payee.name, payee.tin, payor.name, and payor.tin. Use "readable" when a complete visible value can be returned, even if its confidence is low. Use "blank" only when the complete labeled field row or TIN boxes are visible and contain no entered value. Use "unreadable" when text may be present but is obscured, cropped, degraded, or too ambiguous to transcribe.
- A "readable" identity field must have a non-null value. A "blank" or "unreadable" identity field must have a null value and confidence 0. Never describe a clearly empty field as unreadable, and never guess a blank field from nearby names, TINs, addresses, filenames, or outside context.
- fieldConfidence.taxRows must contain exactly one entry per taxRows item in the same order, and each confidence entry must repeat the corresponding taxRows lineNumber.
- Keep confidence as the existing group-level assessment. Use signer.signature.confidence only for signature presence; do not duplicate signature presence in fieldConfidence.
- Do not return OCR text, Markdown, explanations, PDF bytes, prompts, thoughts, or any property outside the schema.`;

export function validateDocumentExtractionPages(
  result: DocumentExtractionResultV3,
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
  const comparablePageCounts = new Set([
    actualPageCount,
    actualPageCount - ignoredBlankPageNumbers.size,
  ]);
  if (!comparablePageCounts.has(result.classification.pageCount)) {
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
