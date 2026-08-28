import { z } from "zod";

export const IDENTITY_FIELD_REREAD_SCHEMA_VERSION = 2 as const;
export const IDENTITY_FIELD_REREAD_PROMPT_VERSION =
  "bir2307-identity-field-reread-v2-visibility" as const;

export type IdentityParty = "payee" | "payor";
export type IdentityField = "name" | "tin";
export type IdentityFieldPath = `${IdentityParty}.${IdentityField}`;

export const identityFieldRereadResultSchema = z
  .object({
    schemaVersion: z.literal(IDENTITY_FIELD_REREAD_SCHEMA_VERSION),
    value: z.string().trim().min(1).nullable(),
    confidence: z.number().min(0).max(1),
    visibility: z.enum(["readable", "blank", "unreadable"]),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.value === null && result.confidence !== 0) {
      context.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "Confidence must be zero when the reread value is null",
      });
    }
    if (result.visibility === "readable" && result.value === null) {
      context.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "A readable field must have a non-null value",
      });
    }
    if (result.visibility !== "readable" && result.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "A blank or unreadable field must have a null value",
      });
    }
  });

export type IdentityFieldRereadResult = z.infer<
  typeof identityFieldRereadResultSchema
>;

export const IDENTITY_FIELD_REREAD_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "value", "confidence", "visibility"],
  properties: {
    schemaVersion: {
      type: "integer",
      enum: [IDENTITY_FIELD_REREAD_SCHEMA_VERSION],
    },
    value: {
      type: ["string", "null"],
      minLength: 1,
      description: "The requested identity field exactly as visibly printed.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description:
        "Certainty that value was read correctly from the visible crop, independent of outside context.",
    },
    visibility: {
      type: "string",
      enum: ["readable", "blank", "unreadable"],
      description:
        "Whether the complete field has a visible value, is visibly empty, or may contain text that cannot be read reliably.",
    },
  },
} as const;

export function buildIdentityFieldRereadPrompt(input: {
  party: IdentityParty;
  field: IdentityField;
}): string {
  const partyLabel =
    input.party === "payee"
      ? "payee/income recipient"
      : "payor/withholding agent";
  const fieldRules =
    input.field === "tin"
      ? `- Return the complete TIN as digits only. Preserve every visible leading zero and include every occupied TIN box from left to right.
- Ignore ruled lines, box boundaries, dates, ZIP codes, form numbers, and numbers outside the requested TIN row.`
      : `- Return the complete printed name from the requested name row, preserving visible words and punctuation.
- Ignore the row label, nearby addresses, TINs, signatures, and names belonging to the other party.`;

  return `You are rereading exactly one ${partyLabel} ${input.field} from cropped Philippine BIR Form 2307 images.

All supplied images are alternate views of the same requested field. Return only the JSON object required by the supplied schema.

Rules:
- Read only the requested ${input.party}.${input.field} value visibly printed in the supplied crop or crops.
${fieldRules}
- Return visibility "readable" when a complete visible value can be transcribed, even at low confidence.
- Return visibility "blank" only when the complete labeled row or TIN boxes are visible and contain no entered value. Return null and confidence 0.
- Return visibility "unreadable" when text may be present but a necessary character is cropped, obscured, degraded, illegible, or ambiguous. Return null and confidence 0.
- Never classify a clearly empty field as unreadable, and never infer a blank value from nearby or outside context.
- Confidence measures only certainty that the returned value is what is visibly written. It must not represent plausibility, formatting correctness, or agreement with a filename, selected entity, masterlist, expected taxpayer, or any outside context.
- Score confidence independently from the earlier document extraction. A readable value must be non-null; when value is null, confidence must be 0.
- Do not infer or repair a value using company knowledge, common formats, or surrounding documents.
- Do not return OCR text, Markdown, explanations, warnings, thoughts, or properties outside the schema.`;
}
