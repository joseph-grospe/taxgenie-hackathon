const DEFAULT_OBJECT_PREFIX = "v2";

export type StorageEnv = {
  S3_OBJECT_PREFIX?: string | undefined;
} & Record<string, string | undefined>;

export type EntityStorageInput = {
  id: number;
  shortName?: string | null;
};

export type CustomerStorageInput = {
  id?: number | null;
  shortName?: string | null;
};

export type StorageKeyBaseInput = {
  prefix?: string;
  entityKey: string;
};

export type CustomerScopedStorageKeyInput = StorageKeyBaseInput & {
  customerKey?: string | null;
};

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/gu, "");

export function getStorageObjectPrefix(env: StorageEnv = process.env): string {
  const prefix = trimSlashes(
    env.S3_OBJECT_PREFIX?.trim() || DEFAULT_OBJECT_PREFIX,
  );
  return prefix.length > 0 ? prefix : DEFAULT_OBJECT_PREFIX;
}

export function sanitizeStoragePathToken(
  value: string,
  fallback = "item",
): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return sanitized.length > 0 ? sanitized : fallback;
}

export function buildEntityStorageKey(entity: EntityStorageInput): string {
  const id = Number.isInteger(entity.id) && entity.id > 0 ? entity.id : 0;
  if (id <= 0) {
    throw new Error("Entity id must be a positive integer.");
  }

  const slug = sanitizeStoragePathToken(entity.shortName ?? "", "");
  return slug.length > 0 ? `${slug}-${id}` : `entity-${id}`;
}

export function buildOptionalEntityStorageKey(
  entity: Partial<EntityStorageInput> | null | undefined,
  fallback = "entity-unknown",
): string {
  if (!entity || !Number.isInteger(entity.id) || Number(entity.id) <= 0) {
    return fallback;
  }

  return buildEntityStorageKey({
    id: Number(entity.id),
    shortName: entity.shortName ?? null,
  });
}

export function buildCustomerStorageKey(
  customer: CustomerStorageInput,
): string {
  const slug = sanitizeStoragePathToken(customer.shortName ?? "", "");
  const id =
    typeof customer.id === "number" &&
    Number.isInteger(customer.id) &&
    customer.id > 0
      ? customer.id
      : null;

  if (slug.length > 0 && id !== null) {
    return `${slug}-${id}`;
  }

  if (slug.length > 0) {
    return slug;
  }

  return id !== null ? `customer-${id}` : "customer-unknown";
}

export function buildOptionalCustomerStorageKey(
  customer: Partial<CustomerStorageInput> | null | undefined,
  fallback = "customer-unknown",
): string {
  if (!customer) {
    return fallback;
  }

  const key = buildCustomerStorageKey({
    id: typeof customer.id === "number" ? customer.id : null,
    shortName: customer.shortName ?? null,
  });
  return key === "customer-unknown" ? fallback : key;
}

export function sanitizeStorageRevision(value: string): string {
  return sanitizeStoragePathToken(value, "revision");
}

export function buildStorageKey(...parts: Array<string | number>): string {
  return parts
    .map((part) => trimSlashes(String(part)))
    .filter((part) => part.length > 0)
    .join("/");
}

export function buildEntityStorageBase(input: StorageKeyBaseInput): string {
  return buildStorageKey(
    input.prefix ?? getStorageObjectPrefix(),
    "entities",
    input.entityKey,
  );
}

export function buildEntityCustomerStorageBase(
  input: CustomerScopedStorageKeyInput,
): string {
  return buildStorageKey(
    buildEntityStorageBase(input),
    "customers",
    sanitizeStoragePathToken(input.customerKey ?? "", "customer-unknown"),
  );
}

export function buildRawUploadKey(
  input: StorageKeyBaseInput & {
    uploadedAt: Date;
    batchId: string;
    uploadId: string;
  },
): string {
  const year = String(input.uploadedAt.getUTCFullYear());
  const month = String(input.uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(input.uploadedAt.getUTCDate()).padStart(2, "0");

  return buildStorageKey(
    buildEntityStorageBase(input),
    "intake",
    year,
    month,
    day,
    input.batchId,
    input.uploadId,
    "source.pdf",
  );
}

export function buildProcessingArtifactKey(
  input: CustomerScopedStorageKeyInput & {
    batchId: string;
    uploadId: string;
    revision: string;
    fileName:
      | "raw-extraction.json"
      | "final-result.json"
      | "duplicate.json"
      | "error.json";
  },
): string {
  return buildStorageKey(
    buildEntityCustomerStorageBase(input),
    "processing",
    input.batchId,
    input.uploadId,
    sanitizeStorageRevision(input.revision),
    input.fileName,
  );
}

export function buildUnsignedCertificateKey(
  input: CustomerScopedStorageKeyInput & {
    period: string;
    batchId: string;
    documentResultId: number | string;
    fileName: string;
  },
): string {
  return buildStorageKey(
    buildEntityCustomerStorageBase(input),
    "certificates",
    sanitizeStoragePathToken(input.period, "period-unknown"),
    input.batchId,
    input.documentResultId,
    "unsigned",
    input.fileName,
  );
}

export function buildSignedCertificateKey(
  input: CustomerScopedStorageKeyInput & {
    period: string;
    batchId: string;
    documentResultId: number | string;
    signedArtifactId: string;
  },
): string {
  return buildStorageKey(
    buildEntityCustomerStorageBase(input),
    "certificates",
    sanitizeStoragePathToken(input.period, "period-unknown"),
    input.batchId,
    input.documentResultId,
    "signed",
    `${sanitizeStoragePathToken(input.signedArtifactId, "signed")}.pdf`,
  );
}

export function buildMergeOutputKey(
  input: StorageKeyBaseInput & {
    mergeJobId: string;
    partNumber: number;
    fileName: string;
  },
): string {
  const safeFileName = input.fileName.replace(/[^A-Za-z0-9._-]/gu, "_");
  return buildStorageKey(
    buildEntityStorageBase(input),
    "merge-jobs",
    input.mergeJobId,
    input.partNumber,
    safeFileName,
  );
}

export function buildSignatureProfileImageKey(input: {
  prefix?: string;
  userId: string;
  assetId: string;
  extension: "png" | "jpg";
}): string {
  return buildStorageKey(
    input.prefix ?? getStorageObjectPrefix(),
    "user-assets",
    input.userId,
    "signature-profile",
    `${sanitizeStoragePathToken(input.assetId, "signature")}.${input.extension}`,
  );
}
