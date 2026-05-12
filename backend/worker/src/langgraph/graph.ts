import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Logger } from "@taxtrack/shared";
import type { S3Client } from "@aws-sdk/client-s3";
import type { RunnableConfig } from "@langchain/core/runnables";
import { loadAtcRates } from "../db/atcCodes";
import type { DbClient } from "../db/client";
import { insertWorkerStep, setJobCurrentStep } from "../db/progress";
import { createLoadInputNode } from "./nodes/loadInput";
import { createExtractDocumentNode } from "./nodes/extractDocument";
import { createCheckMasterlistNode } from "./nodes/checkMasterlist";
import { createNormalizeFieldsNode } from "./nodes/normalizeFields";
import { createPersistValidationFailNode } from "./nodes/persistValidationFail";
import { createPersistDuplicateNode } from "./nodes/persistDuplicate";
import { createPersistValidatedNode } from "./nodes/persistResults";
import { createDedupeCheckNode } from "./nodes/dedupeCheck";
import { createFinalizeWorkflowNode } from "./nodes/finalizeWorkflow";
import { createValidateEntityTinNode } from "./nodes/validateEntityTin";
import { createValidateRulesNode } from "./nodes/validateRules";
import {
  createAzureNormalizerClient,
  type NormalizerConfig,
} from "./services/azureNormalizerClient";
import {
  createMistralClient,
  type OcrClientConfig,
} from "./services/mistralClient";
import { type WorkflowEngineConfig } from "./services/workflowConfig";
import type { WorkflowState } from "./types";
import { createPdfZoneRenderer } from "./utils/pdfZoneRenderer";

const WorkflowAnnotation = Annotation.Root({
  event: Annotation<WorkflowState["event"]>(),
  jobId: Annotation<WorkflowState["jobId"]>(),
  source: Annotation<WorkflowState["source"]>(),
  sourceContentBase64: Annotation<WorkflowState["sourceContentBase64"]>(),
  extracted: Annotation<WorkflowState["extracted"]>(),
  extraction: Annotation<WorkflowState["extraction"]>(),
  normalized: Annotation<WorkflowState["normalized"]>(),
  masterlistLookup: Annotation<WorkflowState["masterlistLookup"]>(),
  pages: Annotation<WorkflowState["pages"]>(),
  batchSummary: Annotation<WorkflowState["batchSummary"]>(),
  validation: Annotation<WorkflowState["validation"]>(),
  decision: Annotation<WorkflowState["decision"]>(),
  artifactKey: Annotation<WorkflowState["artifactKey"]>(),
  artifactKeys: Annotation<WorkflowState["artifactKeys"]>(),
  artifactPointers: Annotation<WorkflowState["artifactPointers"]>(),
  workflowStartedAt: Annotation<WorkflowState["workflowStartedAt"]>(),
  workflowFinishedAt: Annotation<WorkflowState["workflowFinishedAt"]>(),
});

interface GraphDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
  workflowConfig: WorkflowEngineConfig;
  ocrConfig: OcrClientConfig;
  azureConfig: Omit<NormalizerConfig, "logger">;
  sourceBucket?: string;
}

export interface WorkflowInvokeOptions {
  callbacks?: RunnableConfig["callbacks"];
  metadata?: RunnableConfig["metadata"];
  runName?: string;
}

export function createWorkflowGraph(deps: GraphDeps) {
  const workflowConfig = deps.workflowConfig;
  const sourceBucket = deps.sourceBucket ?? deps.bucket;
  const ocrClient = createMistralClient({
    provider: deps.ocrConfig.provider,
    apiKey: deps.ocrConfig.apiKey,
    apiUrl: deps.ocrConfig.apiUrl,
    model: deps.ocrConfig.model,
    timeoutMs: deps.ocrConfig.timeoutMs,
    logger: deps.logger,
  });
  const azureNormalizer = createAzureNormalizerClient({
    apiKey: deps.azureConfig.apiKey,
    endpoint: deps.azureConfig.endpoint,
    deploymentName: deps.azureConfig.deploymentName,
    apiVersion: deps.azureConfig.apiVersion,
    timeoutMs: deps.azureConfig.timeoutMs,
    logger: deps.logger,
  });
  const zoneRenderer = createPdfZoneRenderer({
    dpi: workflowConfig.zoneOcrDpi,
    timeoutMs: workflowConfig.zoneOcrRenderTimeoutMs,
  });

  const routeByDecision = (
    state: WorkflowState,
  ): "continue" | "error" | "duplicate" => {
    if (state.decision?.route === "error") {
      return "error";
    }

    if (state.decision?.route === "duplicate") {
      return "duplicate";
    }

    return "continue";
  };

  const withTrackedNode = (
    phase: string,
    stepName: string,
    node: (state: WorkflowState) => Promise<Partial<WorkflowState>>,
  ) => {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      const startedAt = Date.now();
      await setJobCurrentStep(deps.db, {
        jobId: state.jobId,
        uploadId: state.event.uploadId,
        phase,
        step: stepName,
      });

      try {
        const result = await node(state);
        const decision = result.decision ?? state.decision;
        const status =
          decision?.route === "error"
            ? "error"
            : decision?.route === "duplicate"
              ? "duplicate"
              : "success";

        await insertWorkerStep(deps.db, {
          jobId: state.jobId,
          stepName,
          status,
          durationMs: Date.now() - startedAt,
          metadata: {
            phase,
            route: decision?.route,
            reasonCodes: decision?.reasonCodes ?? [],
          },
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
        });
        throw error;
      }
    };
  };

  const loadInputNode = createLoadInputNode({
    s3: deps.s3,
    sourceBucket,
    logger: deps.logger,
  });
  const extractDocumentNode = createExtractDocumentNode({
    ocrClient,
    zoneRenderer,
    zoneOcrConfig: {
      enabled: workflowConfig.zoneOcrFallbackEnabled,
      maxZonesPerPage: workflowConfig.zoneOcrMaxZonesPerPage,
      singlePageRescueEnabled: workflowConfig.zoneOcrSinglePageRescueEnabled,
    },
    logger: deps.logger,
  });
  const normalizeFieldsNode = createNormalizeFieldsNode({
    normalizer: async (input) => azureNormalizer.normalize(input),
    logger: deps.logger,
  });
  const checkMasterlistNode = createCheckMasterlistNode({
    db: deps.db,
    logger: deps.logger,
  });
  const persistValidationFailNode = createPersistValidationFailNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket,
  });
  const dedupeCheckNode = createDedupeCheckNode({
    db: deps.db,
  });
  const persistDuplicateNode = createPersistDuplicateNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket,
  });
  const persistValidatedNode = createPersistValidatedNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket,
    logger: deps.logger,
  });
  const finalizeWorkflowNode = createFinalizeWorkflowNode();
  const validateRulesNode = createValidateRulesNode({
    getAtcRates: () => loadAtcRates(deps.db),
    varianceThresholdPhp: workflowConfig.varianceThresholdPhp,
    logger: deps.logger,
  });
  const validateEntityTinNode = createValidateEntityTinNode();

  const graph = new StateGraph(WorkflowAnnotation)
    .addNode(
      "load_input",
      withTrackedNode("extract", "load_input", loadInputNode),
    )
    .addNode(
      "extract_document",
      withTrackedNode("extract", "extract_document", extractDocumentNode),
    )
    .addNode(
      "normalize_fields",
      withTrackedNode("normalize", "normalize_fields", normalizeFieldsNode),
    )
    .addNode(
      "check_masterlist",
      withTrackedNode("normalize", "check_masterlist", checkMasterlistNode),
    )
    .addNode(
      "validate_entity_tin",
      withTrackedNode("validate", "validate_entity_tin", validateEntityTinNode),
    )
    .addNode(
      "validate_rules",
      withTrackedNode("validate", "validate_rules", validateRulesNode),
    )
    .addNode(
      "persist_validation_fail",
      withTrackedNode(
        "persist",
        "persist_validation_fail",
        persistValidationFailNode,
      ),
    )
    .addNode(
      "dedupe_check",
      withTrackedNode("persist", "dedupe_check", dedupeCheckNode),
    )
    .addNode(
      "persist_duplicate",
      withTrackedNode("persist", "persist_duplicate", persistDuplicateNode),
    )
    .addNode(
      "persist_validated",
      withTrackedNode("persist", "persist_validated", persistValidatedNode),
    )
    .addNode(
      "finalize_workflow",
      withTrackedNode("persist", "finalize_workflow", finalizeWorkflowNode),
    )
    .addEdge(START, "load_input")
    .addConditionalEdges("load_input", routeByDecision, {
      continue: "extract_document",
      error: "persist_validation_fail",
    })
    .addConditionalEdges("extract_document", routeByDecision, {
      continue: "normalize_fields",
      error: "persist_validation_fail",
    })
    .addConditionalEdges("normalize_fields", routeByDecision, {
      continue: "validate_entity_tin",
      error: "persist_validation_fail",
    })
    .addConditionalEdges("validate_entity_tin", routeByDecision, {
      continue: "check_masterlist",
      error: "persist_validation_fail",
    })
    .addConditionalEdges("check_masterlist", routeByDecision, {
      continue: "validate_rules",
      error: "persist_validation_fail",
    })
    .addConditionalEdges("validate_rules", routeByDecision, {
      continue: "dedupe_check",
      error: "persist_validation_fail",
    })
    .addConditionalEdges("dedupe_check", routeByDecision, {
      continue: "persist_validated",
      duplicate: "persist_duplicate",
    })
    .addEdge("persist_validation_fail", "finalize_workflow")
    .addEdge("persist_duplicate", "finalize_workflow")
    .addEdge("persist_validated", "finalize_workflow")
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
