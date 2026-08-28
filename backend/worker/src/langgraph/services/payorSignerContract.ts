import { z } from "zod";

export const PAYOR_SIGNER_EXTRACTION_SCHEMA_VERSION = 1 as const;
export const PAYOR_SIGNER_EXTRACTION_PROMPT_VERSION =
  "bir2307-payor-signer-v1" as const;

const nullableTrimmedStringSchema = z.string().trim().min(1).nullable();

export const payorSignerExtractionResultSchema = z
  .object({
    printedName: nullableTrimmedStringSchema,
    title: nullableTrimmedStringSchema,
    tin: nullableTrimmedStringSchema,
    companyName: nullableTrimmedStringSchema,
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string().trim().min(1).max(200)),
  })
  .strict();

export type PayorSignerExtractionResult = z.infer<
  typeof payorSignerExtractionResultSchema
>;

export const PAYOR_SIGNER_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "printedName",
    "title",
    "tin",
    "companyName",
    "confidence",
    "warnings",
  ],
  properties: {
    printedName: {
      type: ["string", "null"],
      description:
        "Printed name visibly located in this cropped payor/withholding-agent signer block.",
    },
    title: {
      type: ["string", "null"],
      description:
        "Title or designation visibly associated with the payor signer.",
    },
    tin: {
      type: ["string", "null"],
      description:
        "TIN visibly associated with the payor signer, returned as digits only.",
    },
    companyName: {
      type: ["string", "null"],
      description:
        "Company visibly associated with the payor signer in this crop.",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: {
      type: "array",
      items: { type: "string", maxLength: 200 },
    },
  },
} as const;

export const PAYOR_SIGNER_EXTRACTION_PROMPT = `You are extracting only the payor/withholding-agent signer identity from a cropped Philippine BIR Form 2307 payor signature block.

The crop is bounded to the upper signer block above the first Tax Agent Accreditation row and above CONFORME. Return only the JSON object required by the supplied schema.

Rules:
- printedName, title, tin, and companyName must belong to the payor, the payor's authorized representative, or the payor's tax agent.
- Never use a payee/conforme signer, even if a payee name or signature is visible near a crop edge.
- Never combine identity fields from different people or signature blocks.
- A handwritten signature mark is not a printed name.
- Return null for every blank, illegible, ambiguous, cropped, or absent identity field.
- Never return form labels, declaration text, accreditation numbers, dates, "CONFORME", "Authorized Representative", or "Tax Agent" as identity values.
- Return TIN digits only and preserve visible leading zeroes.
- Do not infer values from the filename, parties elsewhere on the form, or general context.
- Do not return OCR text, Markdown, explanations, image bytes, prompts, thoughts, or properties outside the schema.`;
