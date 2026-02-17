import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  createLangfuseClientFromEnv,
  createLogger,
  loadLambdaEnv,
  type DriveFileEventV1
} from "@taxtrack/shared";
import { enqueueDriveEvents } from "./drive/enqueueEvents";
import { listDriveChanges } from "./drive/listChanges";
import { loadChannelState, updateChannelToken } from "./drive/channelState";
import { normalizeHeaders, verifyWebhookRequest } from "./drive/verifyWebhook";
import { handleWorkspaceEvent } from "./workspaceHandler";

const env = loadLambdaEnv();
const logger = createLogger({ component: "lambda-webhook" });
const langfuse = createLangfuseClientFromEnv(env);
const sqs = new SQSClient({ region: env.AWS_REGION });
const path = (event: Parameters<APIGatewayProxyHandlerV2>[0]) => {
  const pathFromRoute = (event.rawPath ?? "").toLowerCase();
  const pathFromRouteKey = (event.routeKey ?? "").split(" ")[1]?.toLowerCase() ?? "";
  return pathFromRoute || pathFromRouteKey;
};

function buildDriveEvents(changes: Awaited<ReturnType<typeof listDriveChanges>>["changes"]): DriveFileEventV1[] {
  return changes.map((change) => {
    const eventId = `${change.sourceFileId}:${change.revision}`;

    return {
      version: "v1",
      eventId,
      traceId: randomUUID(),
      source: "google-drive",
      sourceFileId: change.sourceFileId,
      revision: change.revision,
      modifiedTime: change.modifiedTime,
      mimeType: change.mimeType,
      artifactUri: change.artifactUri,
      receivedAt: new Date().toISOString()
    };
  });
}

async function handleDriveWebhook(event: Parameters<APIGatewayProxyHandlerV2>[0]): Promise<import("aws-lambda").APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  const baseLog = logger.child({ requestId });

  const headers = normalizeHeaders(event.headers ?? {});
  const validation = verifyWebhookRequest(event, env.DRIVE_WEBHOOK_SECRET);

  if (!validation.valid) {
    baseLog.warn("Rejected webhook request", { reason: validation.message });
    return {
      statusCode: validation.statusCode ?? 400,
      body: JSON.stringify({ error: validation.message })
    };
  }

  const channelId = headers["x-goog-channel-id"]!;
  const resourceId = headers["x-goog-resource-id"]!;
  const resourceState = headers["x-goog-resource-state"]!;

  const trace = langfuse.trace("google-drive-webhook", {
    requestId,
    channelId,
    resourceId,
    resourceState,
    component: "lambda-webhook",
    stage: process.env.SST_STAGE ?? "dev"
  });

  try {
    const channelState = await loadChannelState({
      databaseUrl: env.DATABASE_URL,
      channelId,
      resourceId
    });

    const driveResult = await listDriveChanges({
      event,
      previousPageToken: channelState.pageToken,
      resourceState
    });

    const events = buildDriveEvents(driveResult.changes);

    await enqueueDriveEvents({
      client: sqs,
      queueUrl: env.SQS_QUEUE_URL,
      events
    });

    await updateChannelToken({
      databaseUrl: env.DATABASE_URL,
      channelId,
      resourceId,
      pageToken: driveResult.nextPageToken
    });

    baseLog.info("Webhook processed", {
      eventsEnqueued: events.length,
      nextPageToken: driveResult.nextPageToken
    });

    await trace.end({
      status: "ok",
      eventsEnqueued: events.length
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        enqueued: events.length
      })
    };
  } catch (error) {
    baseLog.error("Webhook handler failed", {
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
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestPath = path(event);

  if (requestPath.includes("google-workspace")) {
    return await handleWorkspaceEvent(event);
  }

  return await handleDriveWebhook(event);
};
