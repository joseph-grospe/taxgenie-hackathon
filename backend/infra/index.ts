import * as pulumi from "@pulumi/pulumi";
import { createData } from "./data";
import { createMergeBatchCompute } from "./compute-merge-batch";
import { createWorkerCompute } from "./compute-worker";
import { createNetwork } from "./network";
import { createPowerSchedule } from "./power-schedule";
import { createQueue } from "./queue";
import { createDataLocalDev } from "./data-localdev";
import { createTaxGenieFrontend } from "./webapp";
import { createBatchRetentionSchedule } from "./batch-retention";
import { optionalString } from "./config";
import { infraSizingOutputs, resolveInfraSizing } from "./sizing";
import type { InfraContext } from "./types";

type InfraProfile = "full" | "localdev";
type InfraScope = "all" | "backend" | "web" | "app";
const fallbackLocalDatabaseUrl =
  "postgresql://taxgenie:taxgenie@localhost:5432/taxgenie";

function resolveInfraProfile(): InfraProfile {
  const raw = process.env.TAXGENIE_INFRA_PROFILE?.trim().toLowerCase();
  if (raw === "localdev") {
    return "localdev";
  }

  return "full";
}

function resolveInfraScope(): InfraScope {
  const raw = process.env.TAXGENIE_INFRA_SCOPE?.trim().toLowerCase();

  if (raw === "backend" || raw === "web" || raw === "app") {
    return raw;
  }

  return "all";
}

function ensureScopedStage(scope: InfraScope, stage: string) {
  if (scope === "all") {
    return;
  }

  if (!stage.endsWith(`-${scope}`)) {
    throw new Error(
      `Partial infra deployment (${scope} scope) must use a dedicated stage.` +
        ` Set SST_STAGE=dev-${scope} for dev or SST_STAGE=prod-${scope} for prod.`,
    );
  }
}

export function buildInfrastructure() {
  const stack = pulumi.getStack();
  const stage = process.env.SST_STAGE ?? stack;
  const region = process.env.AWS_REGION ?? "ap-southeast-1";
  const profile = resolveInfraProfile();
  const scope = resolveInfraScope();
  const powerScheduleEnabled =
    optionalString(
      "powerScheduleEnabled",
      "TAXGENIE_POWER_SCHEDULE_ENABLED",
    ) === "true";
  const webOnly = scope === "web";
  const backendOnly = scope === "backend";
  const appOnly = scope === "app";
  ensureScopedStage(scope, stage);
  const shouldBuildQueue =
    scope === "all" || scope === "backend" || scope === "app";
  const shouldBuildWeb = scope === "all" || scope === "web" || scope === "app";
  const shouldBuildWorker = scope === "all" || scope === "app";
  const shouldBuildMergeBatch = scope === "all" || scope === "app";
  const shouldBuildBatchRetention =
    scope === "all" || scope === "backend" || scope === "app";

  const ctx: InfraContext = {
    stage,
    region,
    namePrefix: `taxgenie-${stage}`,
  };
  const sizing = resolveInfraSizing(stage);
  const sizingOutputs = infraSizingOutputs(sizing);

  const powerScheduleAllowedStage = stage === "dev" || stage === "uat";
  if (powerScheduleEnabled && (!powerScheduleAllowedStage || scope !== "all")) {
    throw new Error(
      "TAXGENIE_POWER_SCHEDULE_ENABLED is currently supported only for SST_STAGE=dev or SST_STAGE=uat with TAXGENIE_INFRA_SCOPE=all.",
    );
  }

  const queue = shouldBuildQueue ? createQueue(ctx) : undefined;
  let web: ReturnType<typeof createTaxGenieFrontend> | undefined;

  if (profile === "localdev") {
    const localDatabaseUrl =
      optionalString("databaseUrl", "DATABASE_URL") ??
      optionalString("localDatabaseUrl", "TAXGENIE_LOCAL_DATABASE_URL") ??
      fallbackLocalDatabaseUrl;

    if (webOnly) {
      web = createTaxGenieFrontend({ region, stage });
      return {
        region,
        stage,
        profile,
        ...sizingOutputs,
        databaseUrl: localDatabaseUrl,
        webUrl: web.url,
      };
    }

    const data = createDataLocalDev(ctx);
    if (shouldBuildWeb) {
      web = createTaxGenieFrontend({
        region,
        stage,
        storageBucket: {
          name: data.storageBucket.bucket,
          arn: data.storageBucket.arn,
        },
        ...(queue ? { queue } : {}),
      });
    }

    return {
      region,
      stage,
      profile,
      ...sizingOutputs,
      queueUrl: queue ? queue.queue.url : undefined,
      dlqUrl: queue ? queue.dlq.url : undefined,
      databaseUrl: localDatabaseUrl,
      storageBucket: data.storageBucket.bucket,
      ...(web ? { webUrl: web.url } : {}),
    };
  }
  if (webOnly) {
    const network = createNetwork(ctx, {
      enableNatInstance: false,
      natInstanceType: sizing.nat.instanceType,
    });
    const data = createData(ctx, { network, sizing });
    web = createTaxGenieFrontend({
      region,
      stage,
      databaseUrl: data.databaseUrl,
      network,
      storageBucket: {
        name: data.storageBucket.bucket,
        arn: data.storageBucket.arn,
      },
      ...(queue ? { queue } : {}),
    });
    return {
      region,
      stage,
      profile,
      ...sizingOutputs,
      dbHost: data.db.host,
      dbName: data.db.database,
      databaseUrl: data.databaseUrl,
      storageBucket: data.storageBucket.bucket,
      webUrl: web.url,
    };
  }

  const network = createNetwork(ctx, {
    enableNatInstance: scope === "all" || scope === "app",
    natInstanceType: sizing.nat.instanceType,
  });
  const data = createData(ctx, { network, sizing });
  const worker = shouldBuildWorker
    ? createWorkerCompute(ctx, {
        network,
        queue: queue!,
        data,
        sizing,
      })
    : undefined;
  const mergeBatch = shouldBuildMergeBatch
    ? createMergeBatchCompute(ctx, {
        network,
        data,
        sizing,
      })
    : undefined;
  const batchRetention = shouldBuildBatchRetention
    ? createBatchRetentionSchedule(ctx, { network, data })
    : undefined;
  web = shouldBuildWeb
    ? createTaxGenieFrontend({
        region,
        stage,
        databaseUrl: data.databaseUrl,
        network,
        storageBucket: {
          name: data.storageBucket.bucket,
          arn: data.storageBucket.arn,
        },
        ...(queue ? { queue } : {}),
        ...(mergeBatch ? { mergeBatch } : {}),
        ...(batchRetention
          ? {
              batchRetention: {
                name: batchRetention.controller.name,
                arn: batchRetention.controller.arn,
              },
            }
          : {}),
      })
    : undefined;

  if (powerScheduleEnabled) {
    createPowerSchedule(ctx, {
      network,
      data,
      worker,
      mergeBatch,
    });
  }

  return {
    region,
    stage,
    profile,
    ...sizingOutputs,
    queueUrl: queue ? queue.queue.url : undefined,
    dlqUrl: queue ? queue.dlq.url : undefined,
    dbHost: data.db.host,
    dbName: data.db.database,
    databaseUrl: data.databaseUrl,
    storageBucket: data.storageBucket.bucket,
    ...(worker ? { workerInstanceId: worker.instance.id } : {}),
    ...(worker
      ? {
          workerInstanceIds: pulumi.all(
            worker.instances.map((instance) => instance.id),
          ),
        }
      : {}),
    ...(mergeBatch ? { mergeBatchJobQueueArn: mergeBatch.jobQueue.arn } : {}),
    ...(mergeBatch
      ? { mergeBatchJobDefinitionArn: mergeBatch.jobDefinition.arn }
      : {}),
    ...(batchRetention
      ? { batchRetentionFunctionName: batchRetention.controller.name }
      : {}),
    ...(web ? { webUrl: web.url } : {}),
  };
}
