export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  child: (meta: Record<string, unknown>) => Logger;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const payload = {
    level,
    message,
    ts: new Date().toISOString(),
    ...(meta ?? {})
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}

export function createLogger(baseMeta: Record<string, unknown> = {}): Logger {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    write(level, message, { ...baseMeta, ...(meta ?? {}) });
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
    child: (meta) => createLogger({ ...baseMeta, ...meta })
  };
}
