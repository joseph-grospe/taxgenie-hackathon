import * as pulumi from "@pulumi/pulumi";
import { createData } from "./data";
import { createElectricSqlCompute } from "./compute-electricsql";
import { createLangfuseCompute } from "./compute-langfuse";
import { createWorkerCompute } from "./compute-worker";
import { createNetwork } from "./network";
import { createQueue } from "./queue";
import { createWebhookLocalDev } from "./webhook-localdev";
import { createWebhook } from "./webhook";
import { createWebTrackFrontend } from "./webapp";
import type { InfraContext } from "./types";

type InfraProfile = "full" | "localdev";

function resolveInfraProfile(): InfraProfile {
  const raw = process.env.TAXTRACK_INFRA_PROFILE?.trim().toLowerCase();
  if (raw === "localdev") {
    return "localdev";
  }

  return "full";
}

export function buildInfrastructure() {
  const stack = pulumi.getStack();
  const stage = process.env.SST_STAGE ?? stack;
  const region = process.env.AWS_REGION ?? "ap-southeast-1";
  const profile = resolveInfraProfile();

  const ctx: InfraContext = {
    stage,
    region,
    namePrefix: `taxtrack-${stage}`,
  };

  const queue = createQueue(ctx);

  if (profile === "localdev") {
    const webhook = createWebhookLocalDev(ctx, { queue });
    // const web = createWebTrackFrontend();

    return {
      region,
      stage,
      profile,
      queueUrl: queue.queue.url,
      dlqUrl: queue.dlq.url,
      webhookUrl: webhook.api.apiEndpoint,
      workspaceWebhookFunctionName: webhook.workspaceLambda.name,
      // webUrl: web.url
    };
  }

  const network = createNetwork(ctx);
  const data = createData(ctx, { network });
  const webhook = createWebhook(ctx, { network, queue, data });
  const worker = createWorkerCompute(ctx, { network, queue, data });
  const electricSql = createElectricSqlCompute(ctx, { network, data });
  const langfuse = createLangfuseCompute(ctx, { network });
  const taxTrackWeb = createWebTrackFrontend();

  return {
    region,
    stage,
    profile,
    queueUrl: queue.queue.url,
    dlqUrl: queue.dlq.url,
    dbAddress: data.db.address,
    dbName: data.db.dbName,
    artifactsBucket: data.artifactsBucket.bucket,
    webhookUrl: webhook.api.apiEndpoint,
    workspaceWebhookFunctionName: webhook.workspaceLambda.name,
    workspaceWebhookFunctionArn: webhook.workspaceLambda.arn,
    workerInstanceId: worker.instance.id,
    electricSqlInstanceId: electricSql.instance.id,
    langfusePublicIp: langfuse.eip.publicIp,
    langfuseUrl: pulumi.interpolate`http://${langfuse.eip.publicIp}:3000`,
    webUrl: taxTrackWeb.url,
  };
}
