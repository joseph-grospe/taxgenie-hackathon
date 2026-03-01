import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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

function parseArtifactUri(input: string | undefined, defaultBucket: string): ParsedArtifact | null {
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
      uri: input
    };
  }

  if (!defaultBucket || input.includes("://")) {
    return null;
  }

  return {
    bucket: defaultBucket,
    key: input.replace(/^\/+/u, ""),
    uri: `s3://${defaultBucket}/${input.replace(/^\/+/u, "")}`
  };
}

export function createLoadInputNode(deps: LoadInputDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const now = new Date().toISOString();

    const parsed = parseArtifactUri(state.event.artifactUri, deps.sourceBucket);

    if (!parsed) {
      return {
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: ["missing_artifact_uri"],
          phase: "extract",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        artifactKeys: {
          source: `errors/${state.event.sourceFileId}/${state.event.revision}/error.json`,
          rawResultJson: `errors/${state.event.sourceFileId}/${state.event.revision}/raw-extraction.json`,
          finalResultJson: `errors/${state.event.sourceFileId}/${state.event.revision}/final.json`
        },
        workflowStartedAt: now,
        validation: {
          status: "invalid",
          reasons: ["missing_artifact_uri"],
          checks: [
            {
              code: "MISSING_ARTIFACT_URI",
              passed: false,
              message: "event.artifactUri is missing"
            }
          ]
        },
      };
    }

    try {
      const head = await deps.s3.send(
        new HeadObjectCommand({
          Bucket: parsed.bucket,
          Key: parsed.key
        })
      );

      const get = await deps.s3.send(
        new GetObjectCommand({
          Bucket: parsed.bucket,
          Key: parsed.key
        })
      );
      const body = await readBufferFromBody(get.Body);
      const hash = createHash("sha256").update(body).digest("hex");

      deps.logger.debug("Loaded source artifact", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        bucket: parsed.bucket,
        key: parsed.key,
        size: body.length,
        etag: head.ETag
      });

      return {
        workflowStartedAt: now,
        source: {
          uri: parsed.uri,
          bucket: parsed.bucket,
          key: parsed.key,
          mimeType: state.event.mimeType,
          contentType: head.ContentType,
          size: head.ContentLength ?? body.length,
          etag: head.ETag,
          hash
        },
        sourceContentBase64: body.toString("base64"),
        artifactKeys: {
          source: parsed.key,
          rawResultJson: `results/${state.event.sourceFileId}/${state.event.revision}/raw-extraction.json`,
          finalResultJson: `results/${state.event.sourceFileId}/${state.event.revision}/final-result.json`
        },
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: [],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          startedAt: now
        }
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.logger.warn("Failed to load source artifact", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        reason
      });

      return {
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "source_artifact_unavailable"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        artifactKeys: {
          source: `errors/${state.event.sourceFileId}/${state.event.revision}/source.json`,
          rawResultJson: `errors/${state.event.sourceFileId}/${state.event.revision}/raw-extraction.json`,
          finalResultJson: `errors/${state.event.sourceFileId}/${state.event.revision}/final.json`
        },
        workflowStartedAt: now,
        source: {
          uri: parsed.uri,
          bucket: parsed.bucket,
          key: parsed.key,
          mimeType: state.event.mimeType,
          contentType: undefined,
          size: 0,
          etag: undefined,
          hash: undefined
        },
        validation: {
          status: "invalid",
          reasons: ["source_artifact_unavailable"],
          checks: [
            {
              code: "SOURCE_ARTIFACT_UNAVAILABLE",
              passed: false,
              message: reason
            }
          ]
        }
      };
    }
  };
}
