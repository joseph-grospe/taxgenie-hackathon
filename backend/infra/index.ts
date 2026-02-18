import * as pulumi from "@pulumi/pulumi";
import { createData } from "./data";
import { createElectricSqlCompute } from "./compute-electricsql";
import { createLangfuseCompute } from "./compute-langfuse";
import { createWorkerCompute } from "./compute-worker";
import { createNetwork } from "./network";
import { createQueue } from "./queue";
import { createDataLocalDev } from "./data-localdev";
import { createWebhookLocalDev } from "./webhook-localdev";
import { createWebhook } from "./webhook";
import { createWebTrackFrontend } from "./webapp";
import type { InfraContext } from "./types";

type InfraProfile = "full" | "localdev";
type InfraScope = "all" | "backend" | "web";

function resolveInfraProfile(): InfraProfile {
  const raw = process.env.TAXTRACK_INFRA_PROFILE?.trim().toLowerCase();
  if (raw === "localdev") {
    return "localdev";
  }

  return "full";
}

function resolveInfraScope(): InfraScope {
  const raw = process.env.TAXTRACK_INFRA_SCOPE?.trim().toLowerCase();

  if (raw === "backend" || raw === "web") {
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
      `Partial infra deployment (${scope} scope) must use a dedicated stage.`
      + ` Set SST_STAGE=dev-${scope} for dev or SST_STAGE=prod-${scope} for prod.`,
    );
  }
}

export function buildInfrastructure() {
  const stack = pulumi.getStack();
  const stage = process.env.SST_STAGE ?? stack;
  const region = process.env.AWS_REGION ?? "ap-southeast-1";
  const profile = resolveInfraProfile();
  const scope = resolveInfraScope();
  const webOnly = scope === "web";
  const backendOnly = scope === "backend";
  ensureScopedStage(scope, stage);
  const shouldBuildBackend = !webOnly;

  const ctx: InfraContext = {
    stage,
    region,
    namePrefix: `taxtrack-${stage}`
  };

  const queue = shouldBuildBackend ? createQueue(ctx) : undefined;
  let web: ReturnType<typeof createWebTrackFrontend> | undefined;

  if (profile === "localdev") {
    if (webOnly) {
      web = createWebTrackFrontend({ region });
      return {
        region,
        stage,
        profile,
        webUrl: web.url,
      };
    }

    const data = createDataLocalDev(ctx);
    const webhook = backendOnly ? undefined : createWebhookLocalDev(ctx, { queue: queue! });

    if (!backendOnly) {
      web = createWebTrackFrontend({
        region,
        s3Bucket: {
          name: data.sourceFilesBucket.bucket,
          arn: data.sourceFilesBucket.arn,
        },
      });
    }

    return {
      region,
      stage,
      profile,
      queueUrl: queue ? queue.queue.url : undefined,
      dlqUrl: queue ? queue.dlq.url : undefined,
      artifactsBucket: data.artifactsBucket.bucket,
      sourceFilesBucket: data.sourceFilesBucket.bucket,
      ...(webhook ? { webhookUrl: webhook.api.apiEndpoint } : {}),
      ...(web ? { webUrl: web.url } : {}),
    };
  }
  if (webOnly) {
    web = createWebTrackFrontend({ region });
    return {
      region,
      stage,
      profile,
      webUrl: web.url,
    };
  }

  const network = createNetwork(ctx);
  const data = createData(ctx, { network });
    const webhook = backendOnly ? undefined : createWebhook(ctx, { network, queue: queue!, data });
  const worker = backendOnly ? undefined : createWorkerCompute(ctx, { network, queue: queue!, data });
  const electricSql = backendOnly ? undefined : createElectricSqlCompute(ctx, { network, data });
  const langfuse = backendOnly ? undefined : createLangfuseCompute(ctx, { network });
  web = backendOnly
    ? undefined
    : createWebTrackFrontend({
      region,
      s3Bucket: {
        name: data.sourceFilesBucket.bucket,
        arn: data.sourceFilesBucket.arn,
      },
    });

  return {
    region,
    stage,
    profile,
    queueUrl: queue ? queue.queue.url : undefined,
    dlqUrl: queue ? queue.dlq.url : undefined,
    dbAddress: data.db.address,
    dbName: data.db.dbName,
    artifactsBucket: data.artifactsBucket.bucket,
    sourceFilesBucket: data.sourceFilesBucket.bucket,
    ...(webhook ? { webhookUrl: webhook.api.apiEndpoint } : {}),
    ...(worker ? { workerInstanceId: worker.instance.id } : {}),
    ...(electricSql ? { electricSqlInstanceId: electricSql.instance.id } : {}),
    ...(langfuse ? { langfusePublicIp: langfuse.eip.publicIp } : {}),
    ...(langfuse
      ? { langfuseUrl: pulumi.interpolate`http://${langfuse.eip.publicIp}:3000` }
      : {}),
    ...(web ? { webUrl: web.url } : {}),
  };
}
