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

export function createLangfuseClientFromEnv(env: {
  LANGFUSE_ENABLED?: boolean;
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
}): LangfuseClient {
  return new LangfuseClient({
    enabled: env.LANGFUSE_ENABLED,
    host: env.LANGFUSE_HOST,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY
  });
}
