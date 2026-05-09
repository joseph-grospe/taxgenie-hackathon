import assert from "node:assert/strict";
import test from "node:test";

import { createCheckMasterlistNode } from "./checkMasterlist.ts";
import type {
  MasterlistMatch,
  WorkflowPageState,
  WorkflowState,
} from "../types.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

interface DbCapture {
  conditions: unknown[];
  limit?: number;
}

function masterlistMatch(tin: string): MasterlistMatch {
  return {
    region: "NCR",
    entity: "Entity A",
    shortName: "EA",
    customerName: "Customer A",
    tin,
    address: "Manila",
    emailAddress: "customer@example.com",
  };
}

function createDb(matches: MasterlistMatch[], capture: DbCapture) {
  return {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          capture.conditions.push(condition);

          return {
            limit: async (limit: number) => {
              capture.limit = limit;
              return matches;
            },
          };
        },
      }),
    }),
  };
}

function getSqlStringParams(condition: unknown): string[] {
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;

  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks.filter(
    (chunk): chunk is string => typeof chunk === "string",
  );
}

function createState(page: Partial<WorkflowPageState>): WorkflowState {
  return {
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "certificate.pdf",
    } as WorkflowState["event"],
    jobId: "job-1",
    pages: [
      {
        pageNumber: 1,
        classification: "certificate",
        ...page,
      },
    ],
    batchSummary: {
      totalPages: 1,
      certificatePageNumbers: [1],
      ignoredPageNumbers: [],
      validPageNumbers: [],
      failedPageNumbers: [],
      duplicatePageNumbers: [],
    },
  };
}

async function runMasterlistCheck(input: {
  page: Partial<WorkflowPageState>;
  matches: MasterlistMatch[];
}) {
  const capture: DbCapture = { conditions: [] };
  const checkMasterlist = createCheckMasterlistNode({
    db: createDb(input.matches, capture) as never,
    logger: logger as never,
  });
  const result = await checkMasterlist(createState(input.page));

  return { capture, result };
}

test("checkMasterlist matches normalized payorTin against the first 9 masterlist TIN digits", async () => {
  const { capture, result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "007-833-205-000",
      },
    },
    matches: [masterlistMatch("007833205000")],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.payorTin, "007833205000");
  assert.equal(result.masterlistLookup?.query, "007833205");
  assert.equal(capture.limit, 10);
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), [
    "007833205%",
  ]);
});

test("checkMasterlist ignores longer payorTin branch suffixes", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "007-833-205-00000",
      },
    },
    matches: [masterlistMatch("007833205000")],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.payorTin, "00783320500000");
  assert.equal(result.masterlistLookup?.query, "007833205");
  assert.equal(result.masterlistLookup?.matches[0]?.tin, "007833205000");
});

test("checkMasterlist can fall back to extracted payorTin", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      extracted: {
        fields: {
          payorTin: "007833205000",
        },
      },
    },
    matches: [masterlistMatch("007-833-205-00000")],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.payorTin, "007833205000");
  assert.equal(result.masterlistLookup?.query, "007833205");
  assert.equal(
    result.masterlistLookup?.matches[0]?.tin,
    "007-833-205-00000",
  );
});

test("checkMasterlist falls back to payorName when payorTin has fewer than 9 digits", async () => {
  const { capture, result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "123-456",
        payorName: "Payor A",
      },
    },
    matches: [masterlistMatch("999888777000")],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.payorTin, "123456");
  assert.equal(result.masterlistLookup?.payorName, "Payor A");
  assert.equal(result.masterlistLookup?.query, "Payor A");
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), ["%Payor A%"]);
});

test("checkMasterlist fails when short payorTin has no payorName fallback", async () => {
  const { capture, result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "123-456",
      },
    },
    matches: [masterlistMatch("999888777000")],
  });

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, ["missing_payor_name"]);
  assert.equal(result.masterlistLookup?.status, "skipped");
  assert.equal(result.validation?.checks[0]?.code, "PAYOR_NAME_REQUIRED");
  assert.equal(capture.conditions.length, 0);
});

test("checkMasterlist fails when payorName fallback is not found", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "123-456",
        payorName: "Payor A",
      },
    },
    matches: [],
  });

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "payor_name_not_found_in_masterlist",
  ]);
  assert.equal(result.masterlistLookup?.status, "not_found");
  assert.equal(result.masterlistLookup?.payorTin, "123456");
  assert.equal(result.masterlistLookup?.payorName, "Payor A");
  assert.equal(result.masterlistLookup?.query, "Payor A");
  assert.equal(
    result.validation?.checks[0]?.code,
    "MASTERLIST_PAYOR_NAME_MATCH",
  );
});

test("checkMasterlist fails when no masterlist TIN shares the payorTin prefix", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "007-833-205-000",
      },
    },
    matches: [],
  });

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "payor_tin_not_found_in_masterlist",
  ]);
  assert.equal(result.masterlistLookup?.status, "not_found");
  assert.equal(result.masterlistLookup?.payorTin, "007833205000");
  assert.equal(result.masterlistLookup?.query, "007833205");
  assert.equal(
    result.validation?.checks[0]?.code,
    "MASTERLIST_PAYOR_TIN_MATCH",
  );
  assert.equal(
    result.pages?.[0]?.validation?.checks[0]?.code,
    "MASTERLIST_PAYOR_TIN_MATCH",
  );
});
