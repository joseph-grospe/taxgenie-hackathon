import { optionalString } from "./config";

export type InfraSizingProfile = "default" | "uat" | "prod";

export interface InfraSizing {
  profile: InfraSizingProfile;
  worker: {
    count: number;
    instanceType: string;
    concurrency: number;
  };
  database: {
    instance: string;
    storageGb: number;
    backupRetentionDays: number;
  };
  nat: {
    instanceType: string;
  };
  mergeBatch: {
    maxVcpus: number;
    jobVcpus: string;
    jobMemoryMib: number;
    jobEphemeralGib: number;
  };
}

const defaultSizing: InfraSizing = {
  profile: "default",
  worker: {
    count: 1,
    instanceType: "t3.medium",
    concurrency: 3,
  },
  database: {
    instance: "t4g.micro",
    storageGb: 20,
    backupRetentionDays: 1,
  },
  nat: {
    instanceType: "t3.micro",
  },
  mergeBatch: {
    maxVcpus: 16,
    jobVcpus: "4",
    jobMemoryMib: 16384,
    jobEphemeralGib: 80,
  },
};

const uatSizing: InfraSizing = {
  ...defaultSizing,
  profile: "uat",
  worker: {
    ...defaultSizing.worker,
    count: 2,
    instanceType: "m7i.large",
  },
  database: {
    ...defaultSizing.database,
    instance: "t4g.medium",
    storageGb: 100,
    backupRetentionDays: 7,
  },
};

const prodSizing: InfraSizing = {
  ...defaultSizing,
  profile: "prod",
  database: {
    ...defaultSizing.database,
    backupRetentionDays: 30,
  },
};

function isUatStage(stage: string): boolean {
  return /^uat(?:-|$)/.test(stage);
}

function isProdStage(stage: string): boolean {
  return /^prod(?:-|$)/.test(stage);
}

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function integerInRange(
  name: string,
  value: string,
  min: number,
  max: number,
): number {
  const parsed = positiveInteger(name, value);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }

  return parsed;
}

function positiveNumberString(name: string, value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }

  return value;
}

function optionalInteger(
  configName: string,
  envName: string,
  fallback: number,
): number {
  const raw = optionalString(configName, envName);
  return raw ? positiveInteger(envName, raw) : fallback;
}

function optionalIntegerInRange(
  configName: string,
  envName: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = optionalString(configName, envName);
  return raw ? integerInRange(envName, raw, min, max) : fallback;
}

function optionalNumberString(
  configName: string,
  envName: string,
  fallback: string,
): string {
  const raw = optionalString(configName, envName);
  return raw ? positiveNumberString(envName, raw) : fallback;
}

function optionalInstanceType(
  configName: string,
  envName: string,
  fallback: string,
): string {
  return optionalString(configName, envName) ?? fallback;
}

function optionalDatabaseInstance(
  configName: string,
  envName: string,
  fallback: string,
): string {
  return optionalInstanceType(configName, envName, fallback).replace(
    /^db\./,
    "",
  );
}

export function resolveInfraSizing(stage: string): InfraSizing {
  const base = isUatStage(stage)
    ? uatSizing
    : isProdStage(stage)
      ? prodSizing
      : defaultSizing;

  return {
    profile: base.profile,
    worker: {
      count: optionalIntegerInRange(
        "workerCount",
        "TAXTRACK_WORKER_COUNT",
        base.worker.count,
        1,
        2,
      ),
      instanceType: optionalInstanceType(
        "workerInstanceType",
        "TAXTRACK_WORKER_INSTANCE_TYPE",
        base.worker.instanceType,
      ),
      concurrency: optionalInteger(
        "workerConcurrency",
        "TAXTRACK_WORKER_CONCURRENCY",
        base.worker.concurrency,
      ),
    },
    database: {
      instance: optionalDatabaseInstance(
        "dbInstance",
        "TAXTRACK_DB_INSTANCE",
        base.database.instance,
      ),
      storageGb: optionalInteger(
        "dbStorageGb",
        "TAXTRACK_DB_STORAGE_GB",
        base.database.storageGb,
      ),
      backupRetentionDays: optionalIntegerInRange(
        "dbBackupRetentionDays",
        "TAXTRACK_DB_BACKUP_RETENTION_DAYS",
        base.database.backupRetentionDays,
        1,
        35,
      ),
    },
    nat: {
      instanceType: optionalInstanceType(
        "natInstanceType",
        "TAXTRACK_NAT_INSTANCE_TYPE",
        base.nat.instanceType,
      ),
    },
    mergeBatch: {
      maxVcpus: optionalInteger(
        "mergeBatchMaxVcpus",
        "TAXTRACK_MERGE_BATCH_MAX_VCPUS",
        base.mergeBatch.maxVcpus,
      ),
      jobVcpus: optionalNumberString(
        "mergeJobVcpus",
        "TAXTRACK_MERGE_JOB_VCPUS",
        base.mergeBatch.jobVcpus,
      ),
      jobMemoryMib: optionalInteger(
        "mergeJobMemoryMib",
        "TAXTRACK_MERGE_JOB_MEMORY_MIB",
        base.mergeBatch.jobMemoryMib,
      ),
      jobEphemeralGib: optionalInteger(
        "mergeJobEphemeralGib",
        "TAXTRACK_MERGE_JOB_EPHEMERAL_GIB",
        base.mergeBatch.jobEphemeralGib,
      ),
    },
  };
}

export function infraSizingOutputs(sizing: InfraSizing) {
  return {
    infraSizingProfile: sizing.profile,
    workerCount: sizing.worker.count,
    workerInstanceType: sizing.worker.instanceType,
    workerConcurrency: sizing.worker.concurrency,
    dbInstance: sizing.database.instance,
    dbStorageGb: sizing.database.storageGb,
    dbBackupRetentionDays: sizing.database.backupRetentionDays,
    natInstanceType: sizing.nat.instanceType,
    mergeBatchMaxVcpus: sizing.mergeBatch.maxVcpus,
    mergeJobVcpus: sizing.mergeBatch.jobVcpus,
    mergeJobMemoryMib: sizing.mergeBatch.jobMemoryMib,
    mergeJobEphemeralGib: sizing.mergeBatch.jobEphemeralGib,
  };
}
