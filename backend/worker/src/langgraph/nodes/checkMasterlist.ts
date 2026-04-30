import { ilike, sql } from "drizzle-orm";
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

const payorTinFieldNames = new Set(["payortin"]);
const payorNameFieldNames = new Set(["payorname", "payorname1"]);

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

function normalizeTinValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalized = String(value).replace(/\D/gu, "");
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNameValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractPayorTin(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = extractPayorTin(item);
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (payorTinFieldNames.has(normalizeKey(key))) {
      const match = normalizeTinValue(nestedValue);
      if (match) {
        return match;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const match = extractPayorTin(nestedValue);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function extractPayorName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = extractPayorName(item);
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (payorNameFieldNames.has(normalizeKey(key))) {
      const match = normalizeNameValue(nestedValue);
      if (match) {
        return match;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const match = extractPayorName(nestedValue);
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
    validation: page.validation
      ? {
          ...page.validation,
          reasons: [...page.validation.reasons],
          checks: [...page.validation.checks],
        }
      : undefined,
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
    const page = pages.find((item) => item.classification === "certificate");
    const pageIndex = page
      ? pages.findIndex((item) => item.pageNumber === page.pageNumber)
      : -1;

    if (!page) {
      return {
        pages,
        validation: {
          status: "invalid",
          reasons: ["missing_certificate_payload"],
          checks: [
            {
              code: "MISSING_CERTIFICATE_PAYLOAD",
              passed: false,
              message: "No certificate available for masterlist validation",
            },
          ],
        },
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: ["missing_certificate_payload"],
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
      };
    }

    const normalizedPayorTin =
      normalizeTinValue(page.normalized?.payorTin) ??
      extractPayorTin(page.extracted ?? page.extraction?.raw);
    const payorTinPrefix =
      normalizedPayorTin && normalizedPayorTin.length >= 9
        ? normalizedPayorTin.slice(0, 9)
        : undefined;
    const fallbackPayorName =
      normalizeNameValue(page.normalized?.payorName) ??
      extractPayorName(page.extracted ?? page.extraction?.raw);

    const fail = (
      failed: WorkflowPageState,
      reasonCode: string,
      message: string,
    ): Partial<WorkflowState> => {
      const nextPages = [...pages];
      nextPages.splice(pageIndex, 1, failed);
      const checks = failed.validation?.checks ?? [
        {
          code: "MASTERLIST_VALIDATION_FAILED",
          passed: false,
          message,
        },
      ];

      return {
        pages: nextPages,
        masterlistLookup: failed.masterlistLookup,
        validation: {
          status: "invalid",
          reasons: [reasonCode],
          checks,
        },
        batchSummary: {
          totalPages: state.batchSummary?.totalPages ?? nextPages.length,
          certificatePageNumbers:
            state.batchSummary?.certificatePageNumbers ?? [],
          ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
          validPageNumbers: [],
          failedPageNumbers: [page.pageNumber],
          duplicatePageNumbers: state.batchSummary?.duplicatePageNumbers ?? [],
        },
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
    };

    if (!payorTinPrefix && !fallbackPayorName) {
      return fail(
        buildPageError(
          page,
          {
            status: "skipped",
            matchCount: 0,
            matches: [],
          },
          "missing_payor_name",
          "PAYOR_NAME_REQUIRED",
          "Payor TIN has fewer than 9 digits and payor name is missing before masterlist validation",
        ),
        "missing_payor_name",
        "Payor TIN has fewer than 9 digits and payor name is missing before masterlist validation",
      );
    }

    const lookupMode = payorTinPrefix ? "payorTin" : "payorName";
    const masterlistQuery = payorTinPrefix
      ? `${payorTinPrefix}%`
      : (fallbackPayorName as string);
    const displayQuery = payorTinPrefix ?? fallbackPayorName;

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
        .where(
          payorTinPrefix
            ? sql`regexp_replace(coalesce(${masterlist.tin}, ''), '[^0-9]', '', 'g') LIKE ${masterlistQuery}`
            : ilike(masterlist.customerName, `%${masterlistQuery}%`),
        )
        .limit(10);

      deps.logger.info("Masterlist lookup completed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        lookupMode,
        payorTin: normalizedPayorTin,
        payorTinPrefix,
        payorName: fallbackPayorName,
        certificatePageNumber: page.pageNumber,
        matchCount: matches.length,
      });

      const masterlistLookup: MasterlistLookupResult = {
        status: matches.length > 0 ? "matched" : "not_found",
        payorTin: normalizedPayorTin,
        payorName: fallbackPayorName,
        query: displayQuery,
        matchCount: matches.length,
        matches,
      };

      if (matches.length === 0) {
        const reasonCode = payorTinPrefix
          ? "payor_tin_not_found_in_masterlist"
          : "payor_name_not_found_in_masterlist";
        const checkCode = payorTinPrefix
          ? "MASTERLIST_PAYOR_TIN_MATCH"
          : "MASTERLIST_PAYOR_NAME_MATCH";
        const message = payorTinPrefix
          ? `Payor TIN prefix "${payorTinPrefix}" was not found in the masterlist`
          : `Payor name "${fallbackPayorName}" was not found in the masterlist`;

        return fail(
          buildPageError(
            page,
            masterlistLookup,
            reasonCode,
            checkCode,
            message,
          ),
          reasonCode,
          message,
        );
      }

      pages.splice(pageIndex, 1, {
        ...page,
        masterlistLookup,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      deps.logger.warn("Masterlist lookup failed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        lookupMode,
        payorTin: normalizedPayorTin,
        payorTinPrefix,
        payorName: fallbackPayorName,
        certificatePageNumber: page.pageNumber,
        error: message,
      });

      return fail(
        buildPageError(
          page,
          {
            status: "error",
            payorTin: normalizedPayorTin,
            payorName: fallbackPayorName,
            query: displayQuery,
            matchCount: 0,
            matches: [],
            error: message,
          },
          "masterlist_lookup_failed",
          "MASTERLIST_LOOKUP_FAILED",
          `Masterlist lookup failed: ${message}`,
        ),
        "masterlist_lookup_failed",
        `Masterlist lookup failed: ${message}`,
      );
    }

    return {
      pages,
      masterlistLookup: pages[pageIndex]?.masterlistLookup,
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
