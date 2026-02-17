import { z } from "zod";

export const DriveFileEventV1Schema = z.object({
  version: z.literal("v1"),
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  source: z.literal("google-drive"),
  sourceFileId: z.string().min(1),
  revision: z.string().min(1),
  modifiedTime: z.string().datetime(),
  mimeType: z.string().min(1),
  artifactUri: z.string().url().optional(),
  receivedAt: z.string().datetime()
});

export type DriveFileEventV1 = z.infer<typeof DriveFileEventV1Schema>;

export const QueueMessageSchema = z.object({
  event: DriveFileEventV1Schema
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;
