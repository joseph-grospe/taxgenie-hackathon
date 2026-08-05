import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Logger } from "@taxtrack/shared";
import type { WorkflowState } from "../types";
import { readBufferFromBody } from "../utils/parsing";

interface LoadInputDeps {
  s3: S3Client;
  sourceBucket: string;
  logger: Logger;
}

interface ParsedArtifact {
  bucket: string;
  key: string;
  uri: string;
}

function parseArtifactUri(
  input: string | undefined,
  defaultBucket: string,
): ParsedArtifact | null {
  if (!input) {
    return null;
  }
  if (input.startsWith("s3://")) {
    const withoutScheme = input.replace(/^s3:\/\//u, "");
    const firstSlash = withoutScheme.indexOf("/");
    if (firstSlash < 0) {
      return null;
    }
    return {
      bucket: withoutScheme.slice(0, firstSlash),
      key: withoutScheme.slice(firstSlash + 1),
      uri: input,
    };
  }
  if (!defaultBucket || input.includes("://")) {
    return null;
  }
  const key = input.replace(/^\/+/u, "");
  return { bucket: defaultBucket, key, uri: `s3://${defaultBucket}/${key}` };
}

export function createLoadInputNode(deps: LoadInputDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const startedAt = new Date().toISOString();
    const parsed = parseArtifactUri(state.event.artifactUri, deps.sourceBucket);
    if (!parsed) {
      return {
        workflowStartedAt: startedAt,
        documentStatus: "error",
        reasonCodes: ["missing_artifact_uri"],
        decision: {
          terminalStatus: "Error",
          route: "error",
          documentStatus: "error",
          reasonCodes: ["missing_artifact_uri"],
          phase: "extract",
          startedAt,
          finishedAt: new Date().toISOString(),
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    try {
      const [head, get] = await Promise.all([
        deps.s3.send(
          new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
        ),
        deps.s3.send(
          new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
        ),
      ]);
      const body = await readBufferFromBody(get.Body);
      const hash = createHash("sha256").update(body).digest("hex");

      deps.logger.debug("source_artifact_loaded", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        bucket: parsed.bucket,
        key: parsed.key,
        size: body.length,
        etag: head.ETag,
      });

      return {
        workflowStartedAt: startedAt,
        source: {
          uri: parsed.uri,
          bucket: parsed.bucket,
          key: parsed.key,
          mimeType: state.event.mimeType,
          contentType: head.ContentType,
          size: head.ContentLength ?? body.length,
          etag: head.ETag,
          hash,
        },
        sourceContentBase64: body.toString("base64"),
        documentStatus: undefined,
        reasonCodes: [],
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: [],
          phase: "extract",
          startedAt,
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    } catch (error) {
      deps.logger.warn("source_artifact_load_failed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        workflowStartedAt: startedAt,
        source: {
          uri: parsed.uri,
          bucket: parsed.bucket,
          key: parsed.key,
          mimeType: state.event.mimeType,
        },
        documentStatus: "error",
        reasonCodes: ["source_artifact_unavailable"],
        decision: {
          terminalStatus: "Error",
          route: "error",
          documentStatus: "error",
          reasonCodes: ["source_artifact_unavailable"],
          phase: "extract",
          startedAt,
          finishedAt: new Date().toISOString(),
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }
  };
}
