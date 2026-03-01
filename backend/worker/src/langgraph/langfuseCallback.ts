import type { TraceHandle, TraceSpan } from "@taxtrack/shared";

interface CreateLangGraphLangfuseCallbackInput {
  trace: TraceHandle;
  metadata?: Record<string, unknown>;
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createLangGraphLangfuseCallback(input: CreateLangGraphLangfuseCallbackInput) {
  const activeSpans = new Map<string, TraceSpan>();
  const { trace, metadata = {} } = input;

  return {
    handleChainStart(
      serialized: unknown,
      _inputs: unknown,
      runId?: string,
      _parentRunId?: string,
      _tags?: string[],
      _metadata?: Record<string, unknown>,
      runName?: string
    ): void {
      if (!runId || typeof runId !== "string") {
        return;
      }

      const chainName =
        serialized && typeof serialized === "object" && "name" in serialized
          ? typeof (serialized as { name?: unknown }).name === "string"
            ? `${(serialized as { name?: unknown }).name}`
            : undefined
          : undefined;

      const metadataPayload = {
        ...(metadata ?? {}),
        component: "langgraph",
        runId,
        chainName: chainName ?? runName ?? "graph-chain"
      };

      const spanName =
        runName !== undefined && runName.length > 0
          ? runName
          : chainName !== undefined
            ? `langgraph.${chainName}`
            : "langgraph.chain";

      activeSpans.set(runId, trace.span(spanName, metadataPayload));
    },

    handleChainEnd(_output: unknown, runId?: string): void {
      if (!runId || typeof runId !== "string") {
        return;
      }

      const span = activeSpans.get(runId);
      if (!span) {
        return;
      }

      span.end({ status: "success", component: "langgraph" });
      activeSpans.delete(runId);
    },

    handleChainError(error: unknown, runId?: string): void {
      if (!runId || typeof runId !== "string") {
        return;
      }

      const span = activeSpans.get(runId);
      if (!span) {
        return;
      }

      span.end({
        status: "failed",
        component: "langgraph",
        error: normalizeMessage(error)
      });
      activeSpans.delete(runId);
    }
  };
}
