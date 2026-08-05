import type { S3Client } from "@aws-sdk/client-s3";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Logger } from "@taxtrack/shared";
import { loadAtcRules } from "../db/atcCodes";
import type { DbClient } from "../db/client";
import { insertWorkerStep, setJobCurrentStep } from "../db/progress";
import { createExtractDocumentNode } from "./nodes/extractDocument";
import { createFinalizeWorkflowNode } from "./nodes/finalizeWorkflow";
import { createLoadInputNode } from "./nodes/loadInput";
import { createPersistResultsNode } from "./nodes/persistResults";
import { createProcessCertificatesNode } from "./nodes/processCertificates";
import { createGeminiClient } from "./services/geminiClient";
import type { GeminiExtractionConfig } from "./services/geminiConfig";
import type { WorkflowEngineConfig } from "./services/workflowConfig";
import type { WorkflowPhase, WorkflowState } from "./types";
import { createPdfBlankPageDetector } from "./utils/pdfBlankPageDetector";
import { createPdfRegionRenderer } from "./utils/pdfRegionRenderer";
import { createPdfTextLayerExtractor } from "./utils/pdfTextLayerExtractor";
import { createSignatureVisualDetector } from "./utils/signatureVisualDetector";

export const WORKFLOW_NODE_PHASES = {
  load_input: "extract",
  extract_document: "extract",
  process_certificates: "validate",
  persist_results: "persist",
  finalize_workflow: "persist",
} as const satisfies Record<string, WorkflowPhase>;

export const WORKFLOW_GRAPH_ROUTES = {
  load_input: {
    continue: "extract_document",
    error: "persist_results",
  },
  extract_document: {
    continue: "process_certificates",
    error: "persist_results",
  },
} as const;

const WorkflowAnnotation = Annotation.Root({
  event: Annotation<WorkflowState["event"]>(),
  jobId: Annotation<WorkflowState["jobId"]>(),
  extractionAttemptId: Annotation<WorkflowState["extractionAttemptId"]>(),
  source: Annotation<WorkflowState["source"]>(),
  sourceContentBase64: Annotation<WorkflowState["sourceContentBase64"]>(),
  extractionResult: Annotation<WorkflowState["extractionResult"]>(),
  extractionMetadata: Annotation<WorkflowState["extractionMetadata"]>(),
  extractionPageIssues: Annotation<WorkflowState["extractionPageIssues"]>(),
  ignoredBlankPageNumbers:
    Annotation<WorkflowState["ignoredBlankPageNumbers"]>(),
  certificateSelection: Annotation<WorkflowState["certificateSelection"]>(),
  extractionFailureTelemetry:
    Annotation<WorkflowState["extractionFailureTelemetry"]>(),
  pageCount: Annotation<WorkflowState["pageCount"]>(),
  certificates: Annotation<WorkflowState["certificates"]>(),
  documentStatus: Annotation<WorkflowState["documentStatus"]>(),
  reasonCodes: Annotation<WorkflowState["reasonCodes"]>(),
  decision: Annotation<WorkflowState["decision"]>(),
  documentResultId: Annotation<WorkflowState["documentResultId"]>(),
  workflowStartedAt: Annotation<WorkflowState["workflowStartedAt"]>(),
  workflowFinishedAt: Annotation<WorkflowState["workflowFinishedAt"]>(),
});

interface GraphDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
  workflowConfig: WorkflowEngineConfig;
  geminiConfig: GeminiExtractionConfig;
  sourceBucket?: string;
}

export interface WorkflowInvokeOptions {
  callbacks?: RunnableConfig["callbacks"];
  metadata?: RunnableConfig["metadata"];
  runName?: string;
  signal?: RunnableConfig["signal"];
}

export function createWorkflowGraph(deps: GraphDeps) {
  const sourceBucket = deps.sourceBucket ?? deps.bucket;
  const extractionClient = createGeminiClient({
    ...deps.geminiConfig,
    logger: deps.logger,
  });
  const routeByDecision = (state: WorkflowState): "continue" | "error" =>
    state.decision?.route === "error" ? "error" : "continue";

  const withTrackedNode = (
    phase: WorkflowPhase,
    stepName: string,
    node: (state: WorkflowState) => Promise<Partial<WorkflowState>>,
  ) => {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      const startedAt = Date.now();
      try {
        await setJobCurrentStep(deps.db, {
          jobId: state.jobId,
          uploadId: state.event.uploadId,
          phase,
          step: stepName,
        });
      } catch (error) {
        deps.logger.warn("worker_progress_tracking_failed", {
          jobId: state.jobId,
          stepName,
          phase,
          stage: "start",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const result = await node(state);
        const decision = result.decision ?? state.decision;
        await insertWorkerStep(deps.db, {
          jobId: state.jobId,
          stepName,
          status:
            decision?.route === "error"
              ? "error"
              : decision?.route === "duplicate"
                ? "duplicate"
                : "success",
          durationMs: Date.now() - startedAt,
          metadata: {
            phase,
            route: decision?.route,
            documentStatus: decision?.documentStatus,
            reasonCodes: decision?.reasonCodes ?? [],
          },
        }).catch((error) => {
          deps.logger.warn("worker_step_tracking_failed", {
            jobId: state.jobId,
            stepName,
            phase,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return result;
      } catch (error) {
        await insertWorkerStep(deps.db, {
          jobId: state.jobId,
          stepName,
          status: "failed",
          durationMs: Date.now() - startedAt,
          metadata: {
            phase,
            error: error instanceof Error ? error.message : String(error),
          },
        }).catch(() => undefined);
        throw error;
      }
    };
  };

  const loadInput = createLoadInputNode({
    s3: deps.s3,
    sourceBucket,
    logger: deps.logger,
  });
  const extractDocument = createExtractDocumentNode({
    extractionClient,
    pdfBlankPageDetector: createPdfBlankPageDetector({
      dpi: 72,
      timeoutMs: deps.workflowConfig.signatureVisualTimeoutMs,
    }),
    signatureVisualDetector: deps.workflowConfig.signatureVisualDetectorEnabled
      ? createSignatureVisualDetector({
          dpi: deps.workflowConfig.signatureVisualDpi,
          timeoutMs: deps.workflowConfig.signatureVisualTimeoutMs,
        })
      : undefined,
    signatureVisualMinConfidence:
      deps.workflowConfig.signatureVisualMinConfidence,
    payorSignerVerificationEnabled:
      deps.workflowConfig.payorSignerVerificationEnabled,
    pdfTextLayerExtractor:
      deps.workflowConfig.payorSignerVerificationEnabled &&
      deps.workflowConfig.pdfTextLayerFallbackEnabled
        ? createPdfTextLayerExtractor({
            timeoutMs: deps.workflowConfig.signatureVisualTimeoutMs,
          })
        : undefined,
    pdfRegionRenderer:
      deps.workflowConfig.payorSignerVerificationEnabled &&
      deps.workflowConfig.signatureVisualDetectorEnabled
        ? createPdfRegionRenderer({
            timeoutMs: deps.workflowConfig.signatureVisualTimeoutMs,
          })
        : undefined,
    logger: deps.logger,
  });
  const processCertificates = createProcessCertificatesNode({
    db: deps.db,
    getAtcRules: () => loadAtcRules(deps.db),
    varianceThresholdPhp: deps.workflowConfig.varianceThresholdPhp,
    logger: deps.logger,
  });
  const persistResults = createPersistResultsNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket,
    logger: deps.logger,
  });
  const finalizeWorkflow = createFinalizeWorkflowNode();

  const graph = new StateGraph(WorkflowAnnotation)
    .addNode("load_input", withTrackedNode("extract", "load_input", loadInput))
    .addNode(
      "extract_document",
      withTrackedNode("extract", "extract_document", extractDocument),
    )
    .addNode(
      "process_certificates",
      withTrackedNode("validate", "process_certificates", processCertificates),
    )
    .addNode(
      "persist_results",
      withTrackedNode("persist", "persist_results", persistResults),
    )
    .addNode(
      "finalize_workflow",
      withTrackedNode("persist", "finalize_workflow", finalizeWorkflow),
    )
    .addEdge(START, "load_input")
    .addConditionalEdges("load_input", routeByDecision, {
      ...WORKFLOW_GRAPH_ROUTES.load_input,
    })
    .addConditionalEdges("extract_document", routeByDecision, {
      ...WORKFLOW_GRAPH_ROUTES.extract_document,
    })
    .addEdge("process_certificates", "persist_results")
    .addEdge("persist_results", "finalize_workflow")
    .addEdge("finalize_workflow", END)
    .compile();

  return {
    invoke: (state: WorkflowState, options: WorkflowInvokeOptions = {}) =>
      (
        graph as unknown as {
          invoke: (
            state: WorkflowState,
            options?: WorkflowInvokeOptions,
          ) => Promise<WorkflowState>;
        }
      ).invoke(state, options),
  };
}
