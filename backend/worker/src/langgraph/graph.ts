import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Logger } from "@taxtrack/shared";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../db/client";
import { extractDocumentNode } from "./nodes/extractDocument";
import { loadInputNode } from "./nodes/loadInput";
import { normalizeFieldsNode } from "./nodes/normalizeFields";
import { createPersistResultsNode } from "./nodes/persistResults";
import { validateRulesNode } from "./nodes/validateRules";
import type { WorkflowState } from "./types";

const WorkflowAnnotation = Annotation.Root({
  event: Annotation<WorkflowState["event"]>(),
  jobId: Annotation<WorkflowState["jobId"]>(),
  extracted: Annotation<WorkflowState["extracted"]>(),
  normalized: Annotation<WorkflowState["normalized"]>(),
  validation: Annotation<WorkflowState["validation"]>(),
  artifactKey: Annotation<WorkflowState["artifactKey"]>()
});

interface GraphDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
}

export interface WorkflowInvokeOptions {
  callbacks?: unknown[];
  metadata?: Record<string, unknown>;
  runName?: string;
}

export function createWorkflowGraph(deps: GraphDeps) {
  const persistResultsNode = createPersistResultsNode(deps);

  const graph = new StateGraph(WorkflowAnnotation)
    .addNode("load_input", loadInputNode)
    .addNode("extract_document", extractDocumentNode)
    .addNode("normalize_fields", normalizeFieldsNode)
    .addNode("validate_rules", validateRulesNode)
    .addNode("persist_results", persistResultsNode)
    .addEdge(START, "load_input")
    .addEdge("load_input", "extract_document")
    .addEdge("extract_document", "normalize_fields")
    .addEdge("normalize_fields", "validate_rules")
    .addEdge("validate_rules", "persist_results")
    .addEdge("persist_results", END)
    .compile();

  return {
    invoke: (state: WorkflowState, options: WorkflowInvokeOptions = {}) =>
      (graph as unknown as { invoke: (state: WorkflowState, options?: WorkflowInvokeOptions) => Promise<unknown> }).invoke(
        state,
        options
      )
  };
}
