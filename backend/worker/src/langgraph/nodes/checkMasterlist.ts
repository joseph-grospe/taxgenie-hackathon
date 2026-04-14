import { ilike } from "drizzle-orm";
import type { Logger } from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { masterlist } from "../../db/schema";
import type {
  MasterlistLookupResult,
  ValidationResult,
  WorkflowState,
} from "../types";

interface CheckMasterlistDeps {
  db: DbClient;
  logger: Logger;
}

const payeeFieldNames = new Set([
  "payeename",
  "payeename1",
  "customername",
  "companyname",
  "entityname",
  "registeredname",
]);

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractPayeeName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = extractPayeeName(item);
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (payeeFieldNames.has(normalizeKey(key))) {
      const match = toNonEmptyString(nestedValue);
      if (match) {
        return match;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const match = extractPayeeName(nestedValue);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function continueDecision(
  state: WorkflowState,
): Partial<WorkflowState>["decision"] {
  return {
    terminalStatus: "Done",
    route: "continue",
    reasonCodes: state.decision?.reasonCodes ?? [],
    phase: "validate",
    sourceFileId: state.event.sourceFileId,
    revision: state.event.revision,
    startedAt: state.decision?.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

function errorResult(
  state: WorkflowState,
  masterlistLookup: MasterlistLookupResult,
  reasonCode: string,
  checkCode: string,
  message: string,
): Partial<WorkflowState> {
  const validation: ValidationResult = {
    status: "invalid",
    reasons: [reasonCode],
    checks: [
      {
        code: checkCode,
        passed: false,
        message,
      },
    ],
  };

  return {
    masterlistLookup,
    validation,
    decision: {
      terminalStatus: "Error",
      route: "error",
      reasonCodes: [reasonCode],
      phase: "validate",
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      startedAt: state.decision?.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    },
  };
}

export function createCheckMasterlistNode(deps: CheckMasterlistDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const payeeName =
      toNonEmptyString(state.normalized?.payeeName) ??
      toNonEmptyString(state.normalized?.companyName) ??
      extractPayeeName(state.extracted ?? state.extraction?.raw);

    if (!payeeName) {
      return errorResult(
        state,
        {
          status: "skipped",
          matchCount: 0,
          matches: [],
        },
        "missing_payee_name",
        "PAYEE_NAME_REQUIRED",
        "Payee name is missing before masterlist validation",
      );
    }

    const masterlistQuery = payeeName.trim();

    try {
      const matches = await deps.db
        .select({
          region: masterlist.region,
          entity: masterlist.entity,
          shortName: masterlist.shortName,
          customerName: masterlist.customerName,
          tin: masterlist.tin,
          address: masterlist.address,
          emailAddress: masterlist.emailAddress,
        })
        .from(masterlist)
        .where(ilike(masterlist.customerName, `%${masterlistQuery}%`))
        .limit(10);

      deps.logger.info("Masterlist lookup completed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        payeeName: masterlistQuery,
        matchCount: matches.length,
      });

      const masterlistLookup: MasterlistLookupResult = {
        status: matches.length > 0 ? "matched" : "not_found",
        payeeName: masterlistQuery,
        query: masterlistQuery,
        matchCount: matches.length,
        matches,
      };

      if (matches.length === 0) {
        return errorResult(
          state,
          masterlistLookup,
          "payee_name_not_found_in_masterlist",
          "MASTERLIST_PAYEE_MATCH",
          `Payee name "${masterlistQuery}" was not found in the masterlist`,
        );
      }

      return {
        masterlistLookup: {
          ...masterlistLookup,
        },
        decision: continueDecision(state),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      deps.logger.warn("Masterlist lookup failed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        payeeName,
        error: message,
      });

      return errorResult(
        state,
        {
          status: "error",
          payeeName: masterlistQuery,
          query: masterlistQuery,
          matchCount: 0,
          matches: [],
          error: message,
        },
        "masterlist_lookup_failed",
        "MASTERLIST_LOOKUP_FAILED",
        `Masterlist lookup failed: ${message}`,
      );
    }
  };
}
