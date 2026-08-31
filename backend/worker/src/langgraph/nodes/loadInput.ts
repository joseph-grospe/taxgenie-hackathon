import { createHash } from "node:crypto";
import {
  parseCloudStorageUri,
  type Logger,
  type ObjectStorage,
} from "@taxgenie/shared";
import type { WorkflowState } from "../types";

interface LoadInputDeps {
  storage: ObjectStorage;
  sourceBucket: string;
  logger: Logger;
}

export function createLoadInputNode(deps: LoadInputDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const startedAt = new Date().toISOString();
    const parsed = parseCloudStorageUri(
      state.event.artifactUri,
      deps.sourceBucket,
    );
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
      const [metadata, bytes] = await Promise.all([
        deps.storage.getMetadata(parsed),
        deps.storage.read(parsed),
      ]);
      const body = Buffer.from(bytes);
      const hash = createHash("sha256").update(body).digest("hex");

      deps.logger.debug("source_artifact_loaded", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        bucket: parsed.bucket,
        key: parsed.key,
        size: body.length,
        etag: metadata.etag,
        generation: metadata.generation,
      });

      return {
        workflowStartedAt: startedAt,
        source: {
          uri: parsed.uri,
          bucket: parsed.bucket,
          key: parsed.key,
          mimeType: state.event.mimeType,
          contentType: metadata.contentType,
          size: metadata.size || body.length,
          etag: metadata.generation ?? metadata.etag,
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
