import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";

export interface DriveChange {
  sourceFileId: string;
  revision: string;
  modifiedTime: string;
  mimeType: string;
  artifactUri?: string;
}

export interface DriveChangesResult {
  nextPageToken: string;
  changes: DriveChange[];
}

interface FixturePayload {
  nextPageToken?: string;
  changes?: DriveChange[];
}

function parseFixturePayload(event: APIGatewayProxyEventV2): FixturePayload {
  if (!event.body) {
    return {};
  }

  try {
    return JSON.parse(event.body) as FixturePayload;
  } catch {
    return {};
  }
}

export async function listDriveChanges(input: {
  event: APIGatewayProxyEventV2;
  previousPageToken?: string;
  resourceState: string;
}): Promise<DriveChangesResult> {
  const fixture = parseFixturePayload(input.event);

  if (fixture.changes && fixture.changes.length > 0) {
    return {
      nextPageToken: fixture.nextPageToken ?? randomUUID(),
      changes: fixture.changes
    };
  }

  // Google sends a "sync" resource-state notification when watch is initialized.
  if (input.resourceState.toLowerCase() === "sync") {
    return {
      nextPageToken: input.previousPageToken ?? randomUUID(),
      changes: []
    };
  }

  return {
    nextPageToken: fixture.nextPageToken ?? randomUUID(),
    changes: [
      {
        sourceFileId: `file-${Date.now()}`,
        revision: "1",
        modifiedTime: new Date().toISOString(),
        mimeType: "application/pdf"
      }
    ]
  };
}
