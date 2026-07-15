import assert from "node:assert/strict";
import test from "node:test";

import { WORKFLOW_GRAPH_ROUTES, WORKFLOW_NODE_PHASES } from "./graph.ts";

test("workflow graph runs rule validation before entity and masterlist validation", () => {
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.extract_document.continue,
    "validate_rules",
  );
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.validate_rules.continue,
    "validate_entity_tin",
  );
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.validate_entity_tin.continue,
    "check_masterlist",
  );
  assert.equal(WORKFLOW_GRAPH_ROUTES.check_masterlist.continue, "dedupe_check");
});

test("rule validation can continue through entity and masterlist checks", () => {
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.validate_rules.continue,
    "validate_entity_tin",
  );
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.validate_entity_tin.continue,
    "check_masterlist",
  );
  assert.equal(
    WORKFLOW_GRAPH_ROUTES.check_masterlist.error,
    "persist_validation_fail",
  );
});

test("masterlist check is tracked in the validation phase", () => {
  assert.equal(WORKFLOW_NODE_PHASES.check_masterlist, "validate");
});
