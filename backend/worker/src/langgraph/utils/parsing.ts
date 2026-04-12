const DETERMINISTIC_RATIONALE_DECIMALS = 2;

export function roundMoney(value: number | undefined, decimals = DETERMINISTIC_RATIONALE_DECIMALS): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Number.NaN;
  }

  return Number(value.toFixed(decimals));
}

export function parseMoney(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return roundMoney(raw);
  }

  if (typeof raw === "string") {
    const normalized = raw
      .trim()
      .replace(/[^\d.,\-]/g, "")
      .replace(/,(?=\d{3}(\D|$))/g, "");

    if (!normalized) {
      return undefined;
    }

    const decimal = Number(normalized.replace(/,/g, ""));
    if (!Number.isFinite(decimal)) {
      return undefined;
    }

    return roundMoney(decimal);
  }

  return undefined;
}

export function parseBooleanish(raw: unknown): boolean | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }

  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw === "number") {
    return raw > 0;
  }

  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "y", "present", "exists", "signed"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "absent", "missing", "unsigned"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

export function sanitizeNameToken(raw: unknown, fallback: string): string {
  const base = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  const safe = base
    .normalize("NFKD")
    .replace(/[^\w\-]+/gu, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!safe) {
    return fallback;
  }

  return safe;
}

export function sanitizeTin(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }

  return raw.replace(/\D/g, "");
}

export function extractPeriodEndDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const tokens = raw
    .split(/to|\/|-|_|,|\s/giu)
    .map((token) => token.trim())
    .filter(Boolean);

  const candidates = tokens
    .map((token) => {
      const clean = token.replace(/[^\d/.-]/g, "");
      if (!clean) {
        return undefined;
      }

      const parts = clean.split(/[/. -]/);
      if (parts.length !== 3) {
        return undefined;
      }

      const [a, b, c] = parts;
      let year: number;
      let month: number;
      let day: number;

      if (a.length === 4) {
        year = Number(a);
        month = Number(b);
        day = Number(c);
      } else {
        month = Number(a);
        day = Number(b);
        year = Number(c.length === 2 ? `20${c}` : c);
      }

      if (![year, month, day].every(Number.isFinite)) {
        return undefined;
      }
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        return undefined;
      }

      const d = new Date(Date.UTC(year, month - 1, day));
      if (Number.isNaN(d.getTime())) {
        return undefined;
      }

      return d.toISOString().slice(0, 10);
    })
    .filter((value): value is string => Boolean(value));

  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
}

export function normalizeStringValue(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

export function buildReconciledRevision(raw: string): string {
  const safe = String(raw ?? "").trim();
  if (!safe) {
    return "v1";
  }

  const normalized = safe.replace(/[^\w.-]/g, "_");
  return normalized.length > 0 ? normalized : "v1";
}

export function readTextFromBody(body: unknown): Promise<string> {
  if (!body) {
    return Promise.resolve("");
  }

  if (typeof body === "string") {
    return Promise.resolve(body);
  }

  const typed = body as {
    transformToString?: (encoding?: string) => Promise<string>;
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof typed.transformToString === "function") {
    return typed.transformToString("utf-8");
  }

  if (typeof typed.transformToByteArray === "function") {
    return typed
      .transformToByteArray()
      .then((value) => new TextDecoder().decode(value));
  }

  if (body instanceof Uint8Array) {
    return Promise.resolve(new TextDecoder().decode(body));
  }

  if (body instanceof ArrayBuffer) {
    return Promise.resolve(new TextDecoder().decode(body));
  }

  if ((body as ReadableStream<Uint8Array>)[Symbol.asyncIterator]) {
    return readAsyncIterableBytes(body as AsyncIterable<Uint8Array>)
      .then((value) => new TextDecoder().decode(value));
  }

  return Promise.resolve("");
}

export async function readBufferFromBody(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof Buffer) {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  const typed = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof typed.transformToByteArray === "function") {
    const bytes = await typed.transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks = await readAsyncIterableBytes(body);
  return Buffer.from(chunks);
}

async function readAsyncIterableBytes(body: unknown): Promise<Uint8Array> {
  if (!(body as ReadableStream<Uint8Array>)[Symbol.asyncIterator]) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  const total = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}
