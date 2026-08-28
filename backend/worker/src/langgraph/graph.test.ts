import assert from "node:assert/strict";
import test from "node:test";

import { WORKFLOW_GRAPH_ROUTES, WORKFLOW_NODE_PHASES } from "./graph.ts";

test("workflow graph sends one whole-document extraction into child processing", () => {
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.load_input.continue,
    "extract_document",
  );
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.extract_document.continue,
    "process_certificates",
  );
});

test("load and extraction failures persist a controlled document envelope", () => {
  assert.equal(WORKFLOW_GRAPH_ROUTES.load_input.error, "persist_results");
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.extract_document.error,
    "persist_results",
  );
});

test("certificate processing and persistence use the expected phases", () => {
  assert.equal(WORKFLOW_NODE_PHASES.process_certificates, "validate");
  assert.equal(WORKFLOW_NODE_PHASES.persist_results, "persist");
  assert.equal(WORKFLOW_NODE_PHASES.finalize_workflow, "persist");
});
