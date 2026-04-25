import { ilike } from "drizzle-orm";
import type { Logger } from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { masterlist } from "../../db/schema";
import type {
  MasterlistLookupResult,
  ValidationResult,
  WorkflowPageState,
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

function clonePage(page: WorkflowPageState): WorkflowPageState {
  return {
    ...page,
    extracted: page.extracted ? { ...page.extracted } : undefined,
    normalized: page.normalized ? { ...page.normalized } : undefined,
    validation: page.validation ? { ...page.validation, reasons: [...page.validation.reasons], checks: [...page.validation.checks] } : undefined,
    masterlistLookup: page.masterlistLookup
      ? {
          ...page.masterlistLookup,
          matches: [...page.masterlistLookup.matches],
        }
      : undefined,
  };
}

function buildPageError(
  page: WorkflowPageState,
  masterlistLookup: MasterlistLookupResult,
  reasonCode: string,
  checkCode: string,
  message: string,
): WorkflowPageState {
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
    ...clonePage(page),
    masterlistLookup,
    validation,
    decision: {
      terminalStatus: "Error",
      route: "error",
      reasonCodes: [reasonCode],
      phase: "validate",
    },
  };
}

export function createCheckMasterlistNode(deps: CheckMasterlistDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const pages = (state.pages ?? []).map(clonePage);
    const certificatePages = pages.filter((page) => page.classification === "certificate");
    const failedPageNumbers: number[] = [];
    const reasonCodes: string[] = [];

    for (const page of certificatePages) {
      const payeeName =
        toNonEmptyString(page.normalized?.payeeName) ??
        toNonEmptyString(page.normalized?.companyName) ??
        extractPayeeName(page.extracted ?? page.extraction?.raw);

      if (!payeeName) {
        const failed = buildPageError(
          page,
          {
            status: "skipped",
            matchCount: 0,
            matches: [],
          },
          "missing_payee_name",
          "PAYEE_NAME_REQUIRED",
          "Payee name is missing before masterlist validation",
        );
        reasonCodes.push("missing_payee_name");
        failedPageNumbers.push(page.pageNumber);
        pages.splice(
          pages.findIndex((item) => item.pageNumber === page.pageNumber),
          1,
          failed,
        );
        continue;
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
          pageNumber: page.pageNumber,
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
          const failed = buildPageError(
            page,
            masterlistLookup,
            "payee_name_not_found_in_masterlist",
            "MASTERLIST_PAYEE_MATCH",
            `Payee name "${masterlistQuery}" was not found in the masterlist`,
          );
          reasonCodes.push("payee_name_not_found_in_masterlist");
          failedPageNumbers.push(page.pageNumber);
          pages.splice(
            pages.findIndex((item) => item.pageNumber === page.pageNumber),
            1,
            failed,
          );
          continue;
        }

        pages.splice(
          pages.findIndex((item) => item.pageNumber === page.pageNumber),
          1,
          {
            ...page,
            masterlistLookup,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        deps.logger.warn("Masterlist lookup failed", {
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          payeeName,
          pageNumber: page.pageNumber,
          error: message,
        });

        const failed = buildPageError(
          page,
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
        reasonCodes.push("masterlist_lookup_failed");
        failedPageNumbers.push(page.pageNumber);
        pages.splice(
          pages.findIndex((item) => item.pageNumber === page.pageNumber),
          1,
          failed,
        );
      }
    }

    const primaryPage = pages.find(
      (page) => page.classification === "certificate" && page.masterlistLookup?.status === "matched",
    );

    if (failedPageNumbers.length > 0) {
      return {
        pages,
        masterlistLookup: primaryPage?.masterlistLookup,
        validation: {
          status: "invalid",
          reasons: Array.from(new Set(reasonCodes)),
          checks: failedPageNumbers.map((pageNumber) => ({
            code: "MASTERLIST_PAGE_FAILED",
            passed: false,
            message: `Masterlist validation failed for page ${pageNumber}`,
          })),
        },
        batchSummary: {
          totalPages: state.batchSummary?.totalPages ?? pages.length,
          certificatePageNumbers: state.batchSummary?.certificatePageNumbers ?? [],
          ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
          validPageNumbers: [],
          failedPageNumbers: Array.from(new Set(failedPageNumbers)).sort((a, b) => a - b),
          duplicatePageNumbers: state.batchSummary?.duplicatePageNumbers ?? [],
        },
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: Array.from(new Set(reasonCodes)),
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          startedAt: state.decision?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    }

    return {
      pages,
      masterlistLookup: primaryPage?.masterlistLookup,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        startedAt: state.decision?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    };
  };
}
