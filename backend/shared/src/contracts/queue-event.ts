import { z } from "zod";

export const DocumentIngestEventV1Schema = z.object({
  version: z.literal("v1"),
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  source: z.literal("manual-upload"),
  batchId: z.string().uuid(),
  uploadId: z.string().uuid(),
  sourceFileId: z.string().min(1),
  revision: z.string().min(1),
  originalFileName: z.string().min(1),
  modifiedTime: z.string().datetime(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  /**
   * Optional artifact pointer for source document.
   *
   * For deterministic extraction in the worker workflow, this URI should point to a readable source artifact (typically
   * an `s3://bucket/key` location). If missing/unreadable, the worker routes to a non-retriable `Error` terminal state.
   */
  artifactUri: z.string().url(),
  selectedEntity: z
    .object({
      shortName: z.string().nullable(),
      companyName: z.string().nullable(),
      tin: z.string().min(1),
    })
    .optional(),
  uploadedByUserId: z.string().min(1),
  uploadedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
});

export type DocumentIngestEventV1 = z.infer<typeof DocumentIngestEventV1Schema>;

export const QueueMessageSchema = z.object({
  event: DocumentIngestEventV1Schema,
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;
