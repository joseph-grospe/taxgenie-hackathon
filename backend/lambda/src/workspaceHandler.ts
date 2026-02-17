import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { google } from "googleapis";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createLangfuseClientFromEnv, createLogger, loadLambdaEnv } from "@taxtrack/shared";
import { normalizeHeaders } from "./drive/verifyWebhook";

interface WorkspaceEvent {
  kind: "pubsub" | "webhook";
  eventId: string;
  payload: unknown;
  messageId?: string;
  attributes: Record<string, string>;
}

interface WorkspaceDriveFile {
  content: PassThrough;
  fileName: string;
  mimeType: string;
}

interface WorkspaceDriveMetadata {
  name?: string;
  mimeType?: string;
}

type WorkspaceServiceAccount = Record<string, unknown>;

const env = loadLambdaEnv();
const logger = createLogger({ component: "lambda-google-workspace-webhook" });
const langfuse = createLangfuseClientFromEnv(env);
const s3 = new S3Client({ region: env.AWS_REGION });

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
const DOWNLOAD_FOLDER = "google-drive-files";

let driveClient: ReturnType<typeof google.drive> | null = null;

function getRawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) {
    return "";
  }

  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizePubSubAttributes(attributes: unknown): Record<string, string> {
  if (!attributes || typeof attributes !== "object") {
    return {};
  }

  return Object.entries(attributes).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") {
      acc[key.toLowerCase()] = value;
    }

    return acc;
  }, {});
}

function parseWorkspaceBody(rawBody: string): WorkspaceEvent {
  const parsed = JSON.parse(rawBody);
  const eventId = `google-workspace:${randomUUID()}`;

  if (safeRecord(parsed) && "message" in parsed && safeRecord((parsed as Record<string, unknown>).message)) {
    const message = (parsed as Record<string, unknown>).message as Record<string, unknown>;
    const data = message.data;

    if (typeof data === "string") {
      const decoded = Buffer.from(data, "base64").toString("utf8");
      let payload: unknown = decoded;

      try {
        payload = JSON.parse(decoded);
      } catch {
        // keep raw decoded payload for non-json data
      }

      return {
        kind: "pubsub",
        eventId,
        payload,
        messageId: safeString(message.messageId ?? message.message_id) ?? undefined,
        attributes: normalizePubSubAttributes(message.attributes)
      };
    }
  }

  return {
    kind: "webhook",
    eventId,
    payload: parsed,
    attributes: {}
  };
}

function parseDriveFileIdFromSubject(subject: string): string | null {
  const match = subject.match(/\/drive\/v3\/files\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function extractWorkspaceFileId(event: WorkspaceEvent): string | null {
  const subjectId = safeString(event.attributes["ce-subject"]);
  if (subjectId) {
    const parsed = parseDriveFileIdFromSubject(subjectId);
    if (parsed) {
      return parsed;
    }
  }

  const payload = safeRecord(event.payload);
  const nestedFile = safeRecord(payload?.file);
  const fileId = safeString(nestedFile?.id);
  if (fileId) {
    return fileId;
  }

  return safeString(payload?.id);
}

function parseWorkspaceServiceAccount(raw: string): WorkspaceServiceAccount {
  try {
    const credentials = JSON.parse(raw);
    if (typeof credentials !== "object" || credentials === null || Array.isArray(credentials)) {
      throw new Error();
    }

    return credentials as WorkspaceServiceAccount;
  } catch {
    throw new Error("invalid GOOGLE_WORKSPACE_SERVICE_ACCOUNT_KEY");
  }
}

function getDriveClient() {
  if (driveClient) {
    return driveClient;
  }

  if (!env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_KEY) {
    throw new Error("missing GOOGLE_WORKSPACE_SERVICE_ACCOUNT_KEY");
  }

  // If a credential source exists in env, initialize Drive client from it.
  const credentialsSource = {
    credentials: parseWorkspaceServiceAccount(env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_KEY)
  };

  const auth = new google.auth.GoogleAuth({
    ...credentialsSource,
    scopes: DRIVE_SCOPES
  });

  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildS3Key(fileName: string): string {
  return `${DOWNLOAD_FOLDER}/${randomUUID()}-${sanitizeFileName(fileName)}`;
}

async function downloadFileFromGoogleDrive(fileId: string): Promise<WorkspaceDriveFile> {
  const drive = getDriveClient();

  const metadata = (await drive.files.get({
    fileId,
    fields: "name,mimeType,size",
    supportsAllDrives: true
  })) as { data: WorkspaceDriveMetadata };

  const fileName = metadata.data.name ?? fileId;
  const mimeType = metadata.data.mimeType ?? "application/octet-stream";

  if (mimeType !== "application/pdf") {
    throw new Error(`file is not a PDF. detected: ${mimeType}`);
  }

  const driveResponse = (await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true
    },
    {
      responseType: "stream"
    }
  )) as { data: NodeJS.ReadableStream };

  const source = driveResponse.data;
  if (typeof source !== "object" || source === null || typeof (source as { pipe: unknown }).pipe !== "function") {
    throw new Error(`invalid Google Drive download response for file ${fileId}`);
  }

  const content = new PassThrough();
  (source as NodeJS.ReadableStream).on("error", (error) => {
    content.emit("error", error);
  });
  (source as NodeJS.ReadableStream).pipe(content);

  return {
    content,
    fileName,
    mimeType
  };
}

async function uploadToS3(content: PassThrough, fileName: string, mimeType: string): Promise<string> {
  const bucketName = env.S3_BUCKET ?? process.env.S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("missing S3 bucket");
  }

  const key = buildS3Key(fileName);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content,
      ContentType: mimeType,
      Metadata: {
        source: "google-workspace"
      }
    })
  );

  return key;
}

async function processGoogleDriveFile(fileId: string): Promise<{ fileName: string; s3Key: string }> {
  const { content, fileName, mimeType } = await downloadFileFromGoogleDrive(fileId);
  const s3Key = await uploadToS3(content, fileName, mimeType);
  return { fileName, s3Key };
}

function verifyWorkspaceSecret(event: APIGatewayProxyEventV2): string | null {
  const headers = normalizeHeaders(event.headers ?? {});
  const providedSecret = headers["x-taxtrack-webhook-secret"];

  if (!providedSecret) {
    return null;
  }

  if (providedSecret !== env.DRIVE_WEBHOOK_SECRET) {
    return "invalid webhook secret";
  }

  return null;
}

export async function handleWorkspaceEvent(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  const baseLog = logger.child({ requestId });
  const validationError = verifyWorkspaceSecret(event);

  if (validationError) {
    baseLog.warn("Rejected Google Workspace webhook request", { reason: validationError });
    return {
      statusCode: 401,
      body: JSON.stringify({ error: validationError })
    };
  }

  const rawBody = getRawBody(event);
  if (!rawBody) {
    baseLog.warn("Google Workspace webhook request missing body");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "missing webhook body" })
    };
  }

  if (!env.S3_BUCKET && !process.env.S3_BUCKET_NAME) {
    baseLog.error("Missing S3 bucket config for workspace webhook");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "missing_s3_bucket" })
    };
  }

  const trace = langfuse.trace("google-workspace-webhook", {
    requestId,
    component: "lambda-google-workspace-webhook",
    stage: process.env.SST_STAGE ?? "dev"
  });

  try {
    const workspaceEvent = parseWorkspaceBody(rawBody);
    const fileId = extractWorkspaceFileId(workspaceEvent);

    if (!fileId) {
      baseLog.warn("Unable to resolve Workspace file id", {
        eventId: workspaceEvent.eventId,
        kind: workspaceEvent.kind
      });

      await trace.end({
        status: "error",
        reason: "missing_file_id",
        eventKind: workspaceEvent.kind
      });

      return {
        statusCode: 400,
        body: JSON.stringify({ error: "missing_file_id" })
      };
    }

    const result = await processGoogleDriveFile(fileId);

    baseLog.info("Workspace file stored in S3", {
      eventId: workspaceEvent.eventId,
      fileId,
      fileName: result.fileName,
      key: result.s3Key
    });

    await trace.end({
      status: "ok",
      eventKind: workspaceEvent.kind,
      eventId: workspaceEvent.eventId,
      fileId,
      s3Key: result.s3Key
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        eventId: workspaceEvent.eventId,
        fileId,
        s3Key: result.s3Key,
        fileName: result.fileName
      })
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      baseLog.warn("Invalid Google Workspace webhook payload", {
        error: error.message
      });

      await trace.end({
        status: "error",
        error: error.message
      });

      return {
        statusCode: 400,
        body: JSON.stringify({ error: "invalid_json_body" })
      };
    }

    baseLog.error("Google Workspace webhook handler failed", {
      error: error instanceof Error ? error.message : String(error)
    });

    await trace.end({
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "internal_error" })
    };
  }
}
