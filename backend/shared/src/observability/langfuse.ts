import { Langfuse } from "langfuse";

interface LangfuseClientOptions {
  enabled?: boolean;
  host?: string;
  publicKey?: string;
  secretKey?: string;
}

export interface TraceSpan {
  end: (metadata?: Record<string, unknown>) => Promise<void>;
}

export interface TraceHandle {
  span: (name: string, metadata?: Record<string, unknown>) => TraceSpan;
  end: (metadata?: Record<string, unknown>) => Promise<void>;
}

type RawBool = boolean | string | undefined;
type LangfuseEnv = {
  LANGFUSE_ENABLED?: RawBool;
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  TAXTRACK_LANGFUSE_HOST?: string;
  TAXTRACK_LANGFUSE_PUBLIC_KEY?: string;
  TAXTRACK_LANGFUSE_SECRET_KEY?: string;
  TAXTRACK_LANGFUSE_ENABLED?: RawBool;
};

function normalizeEnabled(value: RawBool): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() !== "false" && value !== "0" && value.toLowerCase() !== "off";
  }

  return true;
}

class NoopTrace implements TraceHandle {
  span(): TraceSpan {
    return {
      end: async () => {
        return;
      }
    };
  }

  async end(): Promise<void> {
    return;
  }
}

export class LangfuseClient {
  private readonly client?: Langfuse;
  private readonly enabled: boolean;

  constructor(options: LangfuseClientOptions) {
    this.enabled = Boolean(options.enabled && options.host && options.publicKey && options.secretKey);

    if (!this.enabled) {
      return;
    }

    this.client = new Langfuse({
      baseUrl: options.host,
      publicKey: options.publicKey,
      secretKey: options.secretKey
    });
  }

  trace(name: string, metadata: Record<string, unknown>): TraceHandle {
    if (!this.client || !this.enabled) {
      return new NoopTrace();
    }

    const client = this.client as any;
    const trace = client.trace({ name, metadata });

    return {
      span: (spanName: string, spanMetadata?: Record<string, unknown>) => {
        const span = trace.span({ name: spanName, metadata: spanMetadata });

        return {
          end: async (endMetadata?: Record<string, unknown>) => {
            span.end({ metadata: endMetadata });
            if (typeof client.flushAsync === "function") {
              await client.flushAsync();
            }
          }
        };
      },
      end: async (endMetadata?: Record<string, unknown>) => {
        trace.update({ metadata: endMetadata });
        if (typeof trace.end === "function") {
          trace.end();
        }
        if (typeof client.flushAsync === "function") {
          await client.flushAsync();
        }
      }
    };
  }
}

export function createLangfuseClientFromEnv(env: LangfuseEnv): LangfuseClient {
  const host = env.LANGFUSE_HOST ?? env.TAXTRACK_LANGFUSE_HOST;
  const publicKey = env.LANGFUSE_PUBLIC_KEY ?? env.TAXTRACK_LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY ?? env.TAXTRACK_LANGFUSE_SECRET_KEY;
  const mismatchPublic =
    env.LANGFUSE_PUBLIC_KEY &&
    env.TAXTRACK_LANGFUSE_PUBLIC_KEY &&
    env.LANGFUSE_PUBLIC_KEY !== env.TAXTRACK_LANGFUSE_PUBLIC_KEY;
  const mismatchSecret =
    env.LANGFUSE_SECRET_KEY &&
    env.TAXTRACK_LANGFUSE_SECRET_KEY &&
    env.LANGFUSE_SECRET_KEY !== env.TAXTRACK_LANGFUSE_SECRET_KEY;
  if (mismatchPublic || mismatchSecret) {
    console.warn(
      "[Langfuse SDK] LANGFUSE_* keys do not match TAXTRACK_LANGFUSE_* keys; using LANGFUSE_* for this process."
    );
  }
  const enabled = normalizeEnabled(env.LANGFUSE_ENABLED ?? env.TAXTRACK_LANGFUSE_ENABLED);

  return new LangfuseClient({
    enabled,
    host,
    publicKey,
    secretKey
  });
}
