import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import {
  LangChainTracer,
  type LangChainTracerFields,
} from "@langchain/core/tracers/tracer_langchain";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Client, type ClientConfig } from "langsmith";
import type { Logger, WorkerEnv } from "@taxtrack/shared";

export const LANGSMITH_APAC_ENDPOINT =
  "https://apac.api.smith.langchain.com";
const LANGSMITH_REDACTED_VALUE = "[REDACTED]";
const LANGSMITH_SENSITIVE_KEYS = new Set([
  "certificate",
  "certificates",
  "evidence",
  "extracted",
  "extraction",
  "extractionresult",
  "payload",
  "payee",
  "payor",
  "prompt",
  "rawresponse",
  "signer",
  "sourcecontentbase64",
  "taxrows",
  "thought",
  "thoughts",
]);

export function redactTraceData(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return LANGSMITH_REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactTraceData(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
      const containsSensitiveField =
        LANGSMITH_SENSITIVE_KEYS.has(normalizedKey) ||
        /(?:address|tin)$/iu.test(normalizedKey) ||
        /(?:pdf|content)base64$/iu.test(normalizedKey);

      return [
        key,
        containsSensitiveField
          ? LANGSMITH_REDACTED_VALUE
          : redactTraceData(item),
      ];
    }),
  );
}

export interface LangSmithTracing {
  callbacks: NonNullable<RunnableConfig["callbacks"]>;
  enabled: boolean;
  flush: () => Promise<void>;
}

interface LangSmithTracingDependencies {
  createClient?: (config: ClientConfig) => Client;
  createTracer?: (fields: LangChainTracerFields) => LangChainTracer;
  awaitCallbacks?: () => Promise<void>;
}

const disabledTracing: LangSmithTracing = {
  callbacks: [],
  enabled: false,
  flush: async () => undefined,
};

export function createLangSmithTracing(
  env: WorkerEnv,
  logger: Logger,
  dependencies: LangSmithTracingDependencies = {},
): LangSmithTracing {
  const endpoint = env.LANGSMITH_ENDPOINT ?? LANGSMITH_APAC_ENDPOINT;
  const project = env.LANGSMITH_PROJECT ?? "taxtrack-dev";
  const apiKey = env.LANGSMITH_API_KEY;

  if (!env.TAXTRACK_LANGSMITH_ENABLED) {
    logger.info("LangSmith tracing disabled", { endpoint, project });
    return disabledTracing;
  }

  if (!apiKey) {
    logger.warn(
      "LangSmith tracing disabled because LANGSMITH_API_KEY is missing",
      { endpoint, project },
    );
    return disabledTracing;
  }

  let client: Client;
  let tracer: LangChainTracer;
  try {
    const clientConfig: ClientConfig = {
      apiKey,
      apiUrl: endpoint,
      hideInputs: (inputs) =>
        redactTraceData(inputs) as Record<string, unknown>,
      hideOutputs: (outputs) =>
        redactTraceData(outputs) as Record<string, unknown>,
    };
    client = (
      dependencies.createClient ?? ((config) => new Client(config))
    )(clientConfig);
    tracer = (
      dependencies.createTracer ?? ((fields) => new LangChainTracer(fields))
    )({
      client,
      projectName: project,
      raiseError: false,
    });
  } catch (error) {
    logger.warn("LangSmith tracing initialization failed", {
      endpoint,
      project,
      error: error instanceof Error ? error.message : String(error),
    });
    return disabledTracing;
  }
  const waitForCallbacks = dependencies.awaitCallbacks ?? awaitAllCallbacks;

  logger.info("LangSmith tracing configured", {
    enabled: true,
    endpoint,
    project,
    hasApiKey: true,
  });

  return {
    callbacks: [tracer],
    enabled: true,
    flush: async () => {
      try {
        await waitForCallbacks();
        await client.flush();
        await client.awaitPendingTraceBatches();
      } catch (error) {
        logger.warn("LangSmith trace flush failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
