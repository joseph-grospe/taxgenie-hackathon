import { sql } from "drizzle-orm";
import type { Logger } from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { masterlist } from "../../db/schema";
import type {
  MasterlistLookupResult,
  MasterlistMatch,
  WorkflowPageState,
  WorkflowState,
} from "../types";
import {
  compactIdentityNameSql,
  normalizeIdentityName,
} from "../utils/identityMatching";
import { normalizeAtcCode } from "../utils/atc";
import {
  buildInvalidValidation,
  mergeValidationResults,
} from "../utils/validation";

interface CheckMasterlistDeps {
  db: DbClient;
  logger: Logger;
}

const payorTinFieldNames = new Set(["payortin"]);
const payorNameFieldNames = new Set(["payorname", "payorname1"]);
const WV020_ATC_CODE = "WV020";
const WV020_GOVERNMENT_REASON = "government_customer_required_for_wv020";
const WV020_GOVERNMENT_CHECK = "WV020_GOVERNMENT_CUSTOMER_REQUIRED";
const WV020_GOVERNMENT_MESSAGE =
  "ATC WV020 is only valid for government customers.";

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
  const validation = buildInvalidValidation(reasonCode, {
    code: checkCode,
    passed: false,
    message,
  });
  const pageValidation =
    mergeValidationResults(page.validation, validation) ?? validation;

  return {
    ...clonePage(page),
    masterlistLookup,
    validation: pageValidation,
    decision: {
      terminalStatus: "Error",
      route: "error",
      reasonCodes: pageValidation.reasons,
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
      const validation =
        failed.validation ??
        buildInvalidValidation(reasonCode, {
          code: "MASTERLIST_VALIDATION_FAILED",
          passed: false,
          message,
        });

      return {
        pages: nextPages,
        masterlistLookup: failed.masterlistLookup,
        validation,
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
          reasonCodes: validation.reasons,
          phase: "validate",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          startedAt: state.decision?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    };

    const compactPayorName = normalizeIdentityName(fallbackPayorName);

    if (!payorTinPrefix && !compactPayorName) {
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

    const runLookup = async (lookupMode: "payorTin" | "payorName") => {
      const masterlistQuery =
        lookupMode === "payorTin"
          ? `${payorTinPrefix}%`
          : (compactPayorName as string);

      const matches = await deps.db
        .select({
          region: masterlist.region,
          entity: masterlist.entity,
          shortName: masterlist.shortName,
          customerName: masterlist.customerName,
          tin: masterlist.tin,
          address: masterlist.address,
          emailAddress: masterlist.emailAddress,
          isGovernment: masterlist.isGovernment,
        })
        .from(masterlist)
        .where(
          lookupMode === "payorTin"
            ? sql`regexp_replace(coalesce(${masterlist.tin}, ''), '[^0-9]', '', 'g') LIKE ${masterlistQuery}`
            : sql`${compactIdentityNameSql(masterlist.customerName)} ILIKE ${`%${masterlistQuery}%`}`,
        )
        .limit(10);

      return matches;
    };

    let lookupMode: "payorTin" | "payorName" = payorTinPrefix
      ? "payorTin"
      : "payorName";
    let displayQuery = payorTinPrefix ?? fallbackPayorName;

    let aggregateValidation = state.validation;

    try {
      let matches: MasterlistMatch[] = payorTinPrefix
        ? await runLookup("payorTin")
        : [];

      if (matches.length === 0 && compactPayorName) {
        lookupMode = "payorName";
        displayQuery = fallbackPayorName;
        matches = await runLookup("payorName");
      }

      deps.logger.info("Masterlist lookup completed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        lookupMode,
        payorTin: normalizedPayorTin,
        payorTinPrefix,
        payorName: fallbackPayorName,
        payorNameLookupKey: compactPayorName,
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
        const reasonCode =
          lookupMode === "payorTin"
            ? "payor_tin_not_found_in_masterlist"
            : "payor_name_not_found_in_masterlist";
        const checkCode =
          lookupMode === "payorTin"
            ? "MASTERLIST_PAYOR_TIN_MATCH"
            : "MASTERLIST_PAYOR_NAME_MATCH";
        const message =
          lookupMode === "payorTin"
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

      const matchedPage: WorkflowPageState = {
        ...page,
        masterlistLookup,
      };
      const atcCode = normalizeAtcCode(
        state.validation?.atcCode ?? page.normalized?.atcCode,
      );

      if (
        atcCode === WV020_ATC_CODE &&
        !matches.some((match) => match.isGovernment === true)
      ) {
        const governmentValidation = buildInvalidValidation(
          WV020_GOVERNMENT_REASON,
          {
            code: WV020_GOVERNMENT_CHECK,
            passed: false,
            message: WV020_GOVERNMENT_MESSAGE,
          },
        );
        const pageValidation =
          mergeValidationResults(page.validation, governmentValidation) ??
          governmentValidation;
        aggregateValidation =
          mergeValidationResults(aggregateValidation, governmentValidation) ??
          governmentValidation;

        matchedPage.validation = pageValidation;
        matchedPage.decision = {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: pageValidation.reasons,
          phase: "validate",
        };
      }

      pages.splice(pageIndex, 1, matchedPage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      deps.logger.warn("Masterlist lookup failed", {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        lookupMode,
        payorTin: normalizedPayorTin,
        payorTinPrefix,
        payorName: fallbackPayorName,
        payorNameLookupKey: compactPayorName,
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

    const hasValidationFailure = aggregateValidation?.status === "invalid";

    return {
      pages,
      masterlistLookup: pages[pageIndex]?.masterlistLookup,
      validation: aggregateValidation,
      decision: {
        terminalStatus: hasValidationFailure ? "Error" : "Done",
        route: hasValidationFailure ? "error" : "continue",
        reasonCodes:
          aggregateValidation?.reasons ?? state.decision?.reasonCodes ?? [],
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        startedAt: state.decision?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    };
  };
}
