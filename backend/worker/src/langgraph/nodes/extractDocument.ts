import type { Logger } from "@taxtrack/shared";
import type { WorkflowState } from "../types";
import type { MistralExtractionClient } from "../services/mistralClient";

interface ExtractDocumentDeps {
  ocrClient: MistralExtractionClient;
  logger: Logger;
}

export function createExtractDocumentNode(deps: ExtractDocumentDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    if (!state.source) {
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "missing_source_metadata"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        validation: {
          status: "invalid",
          reasons: ["missing_source_metadata"],
          checks: [
            {
              code: "MISSING_SOURCE_METADATA",
              passed: false,
              message: "No source metadata available for extraction"
            }
          ]
        }
      };
    }

    if (!state.source.mimeType.toLowerCase().includes("pdf")) {
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "non_pdf_input"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        validation: {
          status: "invalid",
          reasons: ["non_pdf_input"],
          checks: [
            {
              code: "UNSUPPORTED_MIME_TYPE",
              passed: false,
              message: `Unsupported mime type: ${state.source.mimeType}`
            }
          ]
        }
      };
    }

    const sourceBody = state.sourceContentBase64
      ? Buffer.from(state.sourceContentBase64, "base64")
      : Buffer.from("");

    if (!sourceBody.length) {
      deps.logger.error("OCR extraction cannot proceed with empty source body", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      });
      return {
        sourceContentBase64: undefined,
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "source_body_empty"],
          phase: "extract",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        validation: {
          status: "invalid",
          reasons: ["source_body_empty"],
          checks: [
            {
              code: "SOURCE_BODY_EMPTY",
              passed: false,
              message: "Source body is empty"
            }
          ]
        }
      };
    }

    const extraction = await deps.ocrClient.extract({
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      mimeType: state.source.mimeType,
      content: sourceBody
    });

    deps.logger.info("OCR extraction completed", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      provider: extraction.provider,
      sourceHash: state.source.hash
    });

    return {
      sourceContentBase64: undefined,
      extraction,
      extracted: extraction.raw,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "normalize",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        startedAt: state.decision?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString()
      },
      artifactKeys: {
        ...state.artifactKeys,
        rawResultJson:
          state.artifactKeys?.rawResultJson ??
          `results/${state.event.sourceFileId}/${state.event.revision}/raw-extraction.json`
      }
    };
  };
}
