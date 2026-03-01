import { and, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
import type { WorkflowState } from "../types";

interface DedupeDeps {
  db: DbClient;
}

export function createDedupeCheckNode(_deps: DedupeDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const existing = await _deps.db
      .select({ outcome: documentResults.outcome })
      .from(documentResults)
      .where(
        and(
          eq(documentResults.sourceFileId, state.event.sourceFileId),
          eq(documentResults.revision, state.event.revision),
          inArray(documentResults.outcome, ["Done", "Duplicate"])
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        decision: {
          terminalStatus: "Duplicate",
          route: "duplicate",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "duplicate_source_file_revision"],
          phase: "persist",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        artifactKeys: {
          ...state.artifactKeys,
          source: state.artifactKeys?.source ?? `${state.event.sourceFileId}/${state.event.revision}`
        }
      };
    }

    return {
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      },
      artifactKeys: state.artifactKeys
    };
  };
}
