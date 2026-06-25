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

function masterlistMatch(
  tin: string,
  overrides: Partial<MasterlistMatch> = {},
): MasterlistMatch {
  return {
    region: "NCR",
    entity: "Entity A",
    shortName: "EA",
    customerName: "Customer A",
    tin,
    address: "Manila",
    emailAddress: "customer@example.com",
    isGovernment: false,
    ...overrides,
  };
}

function createDb(
  matches: MasterlistMatch[] | Array<MasterlistMatch[]>,
  capture: DbCapture,
) {
  const resultSets =
    matches.length > 0 && Array.isArray(matches[0])
      ? (matches as Array<MasterlistMatch[]>)
      : [matches as MasterlistMatch[]];
  let callCount = 0;

  return {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          capture.conditions.push(condition);

          return {
            limit: async (limit: number) => {
              capture.limit = limit;
              const result = resultSets[callCount] ?? [];
              callCount += 1;
              return result;
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

  return chunks.filter((chunk): chunk is string => typeof chunk === "string");
}

function createState(
  page: Partial<WorkflowPageState>,
  overrides: Partial<WorkflowState> = {},
): WorkflowState {
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
    ...overrides,
  };
}

async function runMasterlistCheck(input: {
  page: Partial<WorkflowPageState>;
  matches: MasterlistMatch[] | Array<MasterlistMatch[]>;
  state?: Partial<WorkflowState>;
}) {
  const capture: DbCapture = { conditions: [] };
  const checkMasterlist = createCheckMasterlistNode({
    db: createDb(input.matches, capture) as never,
    logger: logger as never,
  });
  const result = await checkMasterlist(createState(input.page, input.state));

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
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), ["007833205%"]);
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
  assert.equal(result.masterlistLookup?.matches[0]?.tin, "007-833-205-00000");
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
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), ["%payora%"]);
});

test("checkMasterlist falls back to payorName when payorTin has no masterlist match", async () => {
  const { capture, result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "123-456-789-000",
        payorName: "Payor A",
      },
    },
    matches: [[], [masterlistMatch("999888777000")]],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.query, "Payor A");
  assert.equal(capture.conditions.length, 2);
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), ["123456789%"]);
  assert.deepEqual(getSqlStringParams(capture.conditions[1]), ["%payora%"]);
});

test("checkMasterlist compacts spaces, punctuation, and case for payorName fallback", async () => {
  const { capture, result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "123-456",
        payorName: "  Payor, A Inc. ",
      },
    },
    matches: [masterlistMatch("999888777000")],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.query, "Payor, A Inc.");
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), ["%payorainc%"]);
});

test("checkMasterlist returns final error when earlier validation already failed but masterlist matched", async () => {
  const existingValidation = {
    status: "invalid" as const,
    reasons: ["unknown_atc_code"],
    checks: [
      {
        code: "ATC_RATE_NOT_FOUND",
        passed: false,
        message: "ATC rate not configured: WC999",
      },
    ],
  };
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "007-833-205-000",
      },
      validation: existingValidation,
    },
    state: {
      validation: existingValidation,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: ["unknown_atc_code"],
        phase: "validate",
      },
    },
    matches: [masterlistMatch("007833205000")],
  });

  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, ["unknown_atc_code"]);
  assert.deepEqual(
    result.validation?.checks.map((check) => check.code),
    ["ATC_RATE_NOT_FOUND"],
  );
});

test("checkMasterlist uses compacted contains matching for payorName fallback", async () => {
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
  assert.deepEqual(getSqlStringParams(capture.conditions[0]), ["%payora%"]);
});

test("checkMasterlist allows WV020 when the masterlist customer is government", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        atcCode: "WV020",
        payorTin: "007-833-205-000",
      },
    },
    matches: [masterlistMatch("007833205000", { isGovernment: true })],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(
    result.validation?.reasons.includes(
      "government_customer_required_for_wv020",
    ) ?? false,
    false,
  );
});

test("checkMasterlist fails WV020 when no matched masterlist customer is government", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        atcCode: "WV020",
        payorTin: "007-833-205-000",
      },
    },
    matches: [masterlistMatch("007833205000")],
  });

  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "government_customer_required_for_wv020",
  ]);
  assert.deepEqual(result.validation?.reasons, [
    "government_customer_required_for_wv020",
  ]);
  assert.equal(
    result.validation?.checks[0]?.code,
    "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
  );
  assert.equal(
    result.validation?.checks[0]?.message,
    "ATC WV020 is only valid for government customers.",
  );
  assert.equal(
    result.pages?.[0]?.validation?.checks[0]?.code,
    "WV020_GOVERNMENT_CUSTOMER_REQUIRED",
  );
});

test("checkMasterlist allows WV020 when any matched masterlist customer is government", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        atcCode: "WV020",
        payorTin: "007-833-205-000",
      },
    },
    matches: [
      masterlistMatch("007833205000"),
      masterlistMatch("007833205111", { isGovernment: true }),
    ],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.masterlistLookup?.matchCount, 2);
});

test("checkMasterlist does not require government customers for non-WV020 ATCs", async () => {
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        atcCode: "WC160",
        payorTin: "007-833-205-000",
      },
    },
    matches: [masterlistMatch("007833205000")],
  });

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.masterlistLookup?.status, "matched");
});

test("checkMasterlist appends WV020 government failures to existing validation failures", async () => {
  const existingValidation = {
    status: "invalid" as const,
    reasons: ["variance_exceeded"],
    checks: [
      {
        code: "TAX_BASE_VARIANCE",
        passed: false,
        message: "Variance 10 exceeds threshold 1",
      },
    ],
    atcCode: "WV020",
  };
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        atcCode: "WC160",
        payorTin: "007-833-205-000",
      },
      validation: existingValidation,
    },
    state: {
      validation: existingValidation,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: ["variance_exceeded"],
        phase: "validate",
      },
    },
    matches: [masterlistMatch("007833205000")],
  });

  assert.equal(result.masterlistLookup?.status, "matched");
  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "variance_exceeded",
    "government_customer_required_for_wv020",
  ]);
  assert.deepEqual(
    result.validation?.checks.map((check) => check.code),
    ["TAX_BASE_VARIANCE", "WV020_GOVERNMENT_CUSTOMER_REQUIRED"],
  );
  assert.deepEqual(
    result.pages?.[0]?.validation?.checks.map((check) => check.code),
    ["TAX_BASE_VARIANCE", "WV020_GOVERNMENT_CUSTOMER_REQUIRED"],
  );
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

test("checkMasterlist appends masterlist failures to existing validation failures", async () => {
  const existingValidation = {
    status: "invalid" as const,
    reasons: ["unknown_atc_code"],
    checks: [
      {
        code: "ATC_RATE_NOT_FOUND",
        passed: false,
        message: "ATC rate not configured: WC999",
      },
    ],
  };
  const { result } = await runMasterlistCheck({
    page: {
      normalized: {
        payorTin: "007-833-205-000",
      },
      validation: existingValidation,
    },
    state: {
      validation: existingValidation,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: ["unknown_atc_code"],
        phase: "validate",
      },
    },
    matches: [],
  });

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "unknown_atc_code",
    "payor_tin_not_found_in_masterlist",
  ]);
  assert.deepEqual(
    result.validation?.checks.map((check) => check.code),
    ["ATC_RATE_NOT_FOUND", "MASTERLIST_PAYOR_TIN_MATCH"],
  );
  assert.deepEqual(
    result.pages?.[0]?.validation?.checks.map((check) => check.code),
    ["ATC_RATE_NOT_FOUND", "MASTERLIST_PAYOR_TIN_MATCH"],
  );
});
