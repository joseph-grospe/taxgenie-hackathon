import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Logger } from "@taxtrack/shared";
import type { S3Client } from "@aws-sdk/client-s3";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { DbClient } from "../db/client";
import { createLoadInputNode } from "./nodes/loadInput";
import { createExtractDocumentNode } from "./nodes/extractDocument";
import { createNormalizeFieldsNode } from "./nodes/normalizeFields";
import { createPersistValidationFailNode } from "./nodes/persistValidationFail";
import { createPersistDuplicateNode } from "./nodes/persistDuplicate";
import { createPersistValidatedNode } from "./nodes/persistResults";
import { createReconcileNode } from "./nodes/reconcileDocument";
import { createDedupeCheckNode } from "./nodes/dedupeCheck";
import { createFinalizeWorkflowNode } from "./nodes/finalizeWorkflow";
import { createValidateRulesNode } from "./nodes/validateRules";
import { createAzureNormalizerClient, type NormalizerConfig } from "./services/azureNormalizerClient";
import { createMistralClient, type MistralConfig } from "./services/mistralClient";
import { type WorkflowEngineConfig } from "./services/workflowConfig";
import type { WorkflowState } from "./types";

const WorkflowAnnotation = Annotation.Root({
  event: Annotation<WorkflowState["event"]>(),
  jobId: Annotation<WorkflowState["jobId"]>(),
  source: Annotation<WorkflowState["source"]>(),
  sourceContentBase64: Annotation<WorkflowState["sourceContentBase64"]>(),
  extracted: Annotation<WorkflowState["extracted"]>(),
  extraction: Annotation<WorkflowState["extraction"]>(),
  normalized: Annotation<WorkflowState["normalized"]>(),
  validation: Annotation<WorkflowState["validation"]>(),
  decision: Annotation<WorkflowState["decision"]>(),
  artifactKey: Annotation<WorkflowState["artifactKey"]>(),
  artifactKeys: Annotation<WorkflowState["artifactKeys"]>(),
  artifactPointers: Annotation<WorkflowState["artifactPointers"]>(),
  reconciliation: Annotation<WorkflowState["reconciliation"]>(),
  workflowStartedAt: Annotation<WorkflowState["workflowStartedAt"]>(),
  workflowFinishedAt: Annotation<WorkflowState["workflowFinishedAt"]>()
});

interface GraphDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
  workflowConfig: WorkflowEngineConfig;
  mistralConfig: MistralConfig;
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
  const mistral = createMistralClient({
    apiKey: deps.mistralConfig.apiKey,
    apiUrl: deps.mistralConfig.apiUrl,
    model: deps.mistralConfig.model,
    timeoutMs: deps.mistralConfig.timeoutMs,
    logger: deps.logger
  });
  const azureNormalizer = createAzureNormalizerClient({
    apiKey: deps.azureConfig.apiKey,
    endpoint: deps.azureConfig.endpoint,
    deploymentName: deps.azureConfig.deploymentName,
    apiVersion: deps.azureConfig.apiVersion,
    timeoutMs: deps.azureConfig.timeoutMs,
    logger: deps.logger
  });

  const routeByDecision = (state: WorkflowState): "continue" | "error" | "duplicate" => {
    if (state.decision?.route === "error") {
      return "error";
    }

    if (state.decision?.route === "duplicate") {
      return "duplicate";
    }

    return "continue";
  };

  const loadInputNode = createLoadInputNode({
    s3: deps.s3,
    sourceBucket,
    logger: deps.logger
  });
  const extractDocumentNode = createExtractDocumentNode({
    ocrClient: mistral,
    logger: deps.logger
  });
  const normalizeFieldsNode = createNormalizeFieldsNode({
    normalizer: async (input) => azureNormalizer.normalize(input),
    logger: deps.logger
  });
  const persistValidationFailNode = createPersistValidationFailNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket
  });
  const dedupeCheckNode = createDedupeCheckNode({
    db: deps.db
  });
  const persistDuplicateNode = createPersistDuplicateNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket
  });
  const persistValidatedNode = createPersistValidatedNode({
    db: deps.db,
    s3: deps.s3,
    bucket: deps.bucket,
    logger: deps.logger
  });
  const reconcileNode = createReconcileNode({
    dbClient: deps.db,
    s3: deps.s3,
    bucket: deps.bucket
  });
  const finalizeWorkflowNode = createFinalizeWorkflowNode();
  const validateRulesNode = createValidateRulesNode({
    atcRates: workflowConfig.atcRates,
    varianceThresholdPhp: workflowConfig.varianceThresholdPhp,
    logger: deps.logger
  });

  const graph = new StateGraph(WorkflowAnnotation)
    .addNode("load_input", loadInputNode)
    .addNode("extract_document", extractDocumentNode)
    .addNode("normalize_fields", normalizeFieldsNode)
    .addNode("validate_rules", validateRulesNode)
    .addNode("persist_validation_fail", persistValidationFailNode)
    .addNode("dedupe_check", dedupeCheckNode)
    .addNode("persist_duplicate", persistDuplicateNode)
    .addNode("persist_validated", persistValidatedNode)
    .addNode("reconcile_document", reconcileNode)
    .addNode("finalize_workflow", finalizeWorkflowNode)
    .addEdge(START, "load_input")
    .addConditionalEdges("load_input", routeByDecision, {
      continue: "extract_document",
      error: "persist_validation_fail"
    })
    .addConditionalEdges("extract_document", routeByDecision, {
      continue: "normalize_fields",
      error: "persist_validation_fail"
    })
    .addConditionalEdges("normalize_fields", routeByDecision, {
      continue: "validate_rules",
      error: "persist_validation_fail"
    })
    .addConditionalEdges("validate_rules", routeByDecision, {
      continue: "dedupe_check",
      error: "persist_validation_fail"
    })
    .addConditionalEdges("dedupe_check", routeByDecision, {
      continue: "persist_validated",
      duplicate: "persist_duplicate"
    })
    .addEdge("persist_validation_fail", "finalize_workflow")
    .addEdge("persist_duplicate", "finalize_workflow")
    .addEdge("persist_validated", "reconcile_document")
    .addEdge("reconcile_document", "finalize_workflow")
    .addEdge("finalize_workflow", END)
    .compile();

  return {
    invoke: (state: WorkflowState, options: WorkflowInvokeOptions = {}) =>
      (graph as unknown as { invoke: (state: WorkflowState, options?: WorkflowInvokeOptions) => Promise<WorkflowState> }).invoke(
        state,
        options
      )
  };
}
