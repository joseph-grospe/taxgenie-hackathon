import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
  optionalSecret,
  optionalString,
  requiredSecret,
  requiredString,
} from "./config";
import { enableEc2CloudWatchLogging } from "./ec2-cloudwatch-logging";
import type { InfraSizing } from "./sizing";
import type {
  DataResources,
  InfraContext,
  NetworkResources,
  QueueResources,
} from "./types";

function escapeSystemdUnitValue(value: string | undefined): string {
  return (value ?? "").replace(/%/g, "%%");
}

export interface WorkerInstanceSpec<TSubnet> {
  logicalName: string;
  nameTag: string;
  ordinal: number;
  subnetId: TSubnet;
}

export function buildWorkerInstanceSpecs<TSubnet>(
  namePrefix: string,
  count: number,
  subnets: readonly [TSubnet, TSubnet],
): WorkerInstanceSpec<TSubnet>[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    return {
      logicalName:
        ordinal === 1
          ? `${namePrefix}-worker-ec2`
          : `${namePrefix}-worker-ec2-${ordinal}`,
      nameTag: `${namePrefix}-worker-${ordinal}`,
      ordinal,
      subnetId: subnets[index % subnets.length],
    };
  });
}

export function createWorkerCompute(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    queue: QueueResources;
    data: DataResources;
    sizing: InfraSizing;
    langfuseUrl?: pulumi.Input<string>;
  },
) {
  const workerImageUri = requiredString(
    "workerImageUri",
    "TAXTRACK_WORKER_IMAGE_URI",
  );
  if (workerImageUri === "replace-me" || !workerImageUri.includes("/")) {
    throw new Error(
      "TAXTRACK_WORKER_IMAGE_URI must be a fully qualified image URI before deploying the worker.",
    );
  }
  const workerImageRegistry = workerImageUri.split("/")[0];
  const adminToken = requiredSecret(
    "workerAdminToken",
    "TAXTRACK_WORKER_ADMIN_TOKEN",
  );
  const langfuseHost = optionalString("langfuseHost", "TAXTRACK_LANGFUSE_HOST");
  const langfusePublicKey = requiredSecret(
    "langfusePublicKey",
    "TAXTRACK_LANGFUSE_PUBLIC_KEY",
  );
  const langfuseSecretKey = requiredSecret(
    "langfuseSecretKey",
    "TAXTRACK_LANGFUSE_SECRET_KEY",
  );
  const azureApiKey = optionalSecret("azureApiKey", "AZURE_API_KEY");
  const mistralApiKey = optionalSecret("mistralApiKey", "MISTRAL_API_KEY");
  const ocrProvider =
    optionalString("ocrProvider", "OCR_PROVIDER") ?? "azure_foundry";
  const ocrTimeoutMs = optionalString("ocrTimeoutMs", "OCR_TIMEOUT_MS") ?? "";
  const azureFoundryOcrApiKey = optionalSecret(
    "azureFoundryOcrApiKey",
    "AZURE_FOUNDRY_OCR_API_KEY",
  );
  const azureFoundryOcrApiUrl =
    optionalString("azureFoundryOcrApiUrl", "AZURE_FOUNDRY_OCR_API_URL") ?? "";
  const azureFoundryOcrModel =
    optionalString("azureFoundryOcrModel", "AZURE_FOUNDRY_OCR_MODEL") ?? "";
  const mistralDirectOcrApiKey = optionalSecret(
    "mistralDirectOcrApiKey",
    "MISTRAL_DIRECT_OCR_API_KEY",
  );
  const mistralDirectOcrApiUrl =
    optionalString("mistralDirectOcrApiUrl", "MISTRAL_DIRECT_OCR_API_URL") ??
    "";
  const mistralDirectOcrModel =
    optionalString("mistralDirectOcrModel", "MISTRAL_DIRECT_OCR_MODEL") ?? "";
  const mistralApiUrl =
    optionalString("mistralApiUrl", "MISTRAL_API_URL") ?? "";
  const mistralModel = optionalString("mistralModel", "MISTRAL_MODEL") ?? "";
  const mistralTimeoutMs =
    optionalString("mistralTimeoutMs", "MISTRAL_TIMEOUT_MS") ?? "180000";
  const zoneOcrFallbackEnabled =
    optionalString("zoneOcrFallbackEnabled", "ZONE_OCR_FALLBACK_ENABLED") ??
    "true";
  const zoneOcrDpi = optionalString("zoneOcrDpi", "ZONE_OCR_DPI") ?? "400";
  const zoneOcrRenderTimeoutMs =
    optionalString("zoneOcrRenderTimeoutMs", "ZONE_OCR_RENDER_TIMEOUT_MS") ??
    "60000";
  const zoneOcrMaxZonesPerPage =
    optionalString("zoneOcrMaxZonesPerPage", "ZONE_OCR_MAX_ZONES_PER_PAGE") ??
    "4";
  const zoneOcrSinglePageRescueEnabled =
    optionalString(
      "zoneOcrSinglePageRescueEnabled",
      "ZONE_OCR_SINGLE_PAGE_RESCUE_ENABLED",
    ) ?? "true";
  const persistenceReconcileEnabled =
    optionalString(
      "persistenceReconcileEnabled",
      "PERSISTENCE_RECONCILE_ENABLED",
    ) ?? "true";
  const persistenceReconcileIntervalMs =
    optionalString(
      "persistenceReconcileIntervalMs",
      "PERSISTENCE_RECONCILE_INTERVAL_MS",
    ) ?? "30000";

  const resolveLangfuseHost = (
    configuredHost: string | undefined,
    deployedHost: string | undefined,
  ) => {
    if (configuredHost) {
      try {
        const parsed = new URL(configuredHost);
        const hostname = parsed.hostname.toLowerCase();
        const isLoopback =
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "::1";
        if (!isLoopback) {
          return configuredHost;
        }
      } catch {
        return configuredHost;
      }
    }

    return deployedHost ?? configuredHost ?? "";
  };

  const role = new aws.iam.Role(`${ctx.namePrefix}-worker-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-worker-ssm`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore,
  });

  const logging = enableEc2CloudWatchLogging(ctx, {
    role,
    service: "worker",
  });

  new aws.cloudwatch.LogMetricFilter(
    `${ctx.namePrefix}-worker-visibility-heartbeat-failures`,
    {
      logGroupName: logging.logGroup.name,
      pattern: '"sqs_visibility_heartbeat_failed"',
      metricTransformation: {
        name: "SqsVisibilityHeartbeatFailures",
        namespace: `TaxTrack/${ctx.stage}/Worker`,
        value: "1",
      },
    },
  );

  new aws.iam.RolePolicy(`${ctx.namePrefix}-worker-policy`, {
    role: role.id,
    policy: pulumi
      .all([
        input.queue.queue.arn,
        input.queue.dlq.arn,
        input.data.storageBucket.arn,
      ])
      .apply(([queueArn, dlqArn, storageBucketArn]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes",
                "sqs:ChangeMessageVisibility",
              ],
              Resource: [queueArn, dlqArn],
            },
            {
              Effect: "Allow",
              Action: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
              ],
              Resource: "*",
            },
            {
              Effect: "Allow",
              Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
              Resource: [storageBucketArn, `${storageBucketArn}/*`],
            },
          ],
        }),
      ),
  });

  const profile = new aws.iam.InstanceProfile(
    `${ctx.namePrefix}-worker-profile`,
    {
      role: role.name,
    },
  );

  const ami = aws.ec2.getAmiOutput({
    owners: ["amazon"],
    mostRecent: true,
    filters: [
      {
        name: "name",
        values: ["al2023-ami-2023*-x86_64"],
      },
    ],
  });

  const userData = pulumi
    .all([
      input.queue.queue.url,
      input.data.storageBucket.bucket,
      input.data.databaseUrl,
      adminToken,
      langfusePublicKey,
      langfuseSecretKey,
      azureApiKey,
      mistralApiKey,
      azureFoundryOcrApiKey,
      mistralDirectOcrApiKey,
      input.langfuseUrl ?? "",
    ])
    .apply(
      ([
        queueUrl,
        bucket,
        databaseUrl,
        resolvedAdminToken,
        resolvedLangfusePublicKey,
        resolvedLangfuseSecretKey,
        resolvedAzureApiKey,
        resolvedMistralApiKey,
        resolvedAzureFoundryOcrApiKey,
        resolvedMistralDirectOcrApiKey,
        deployedLangfuseUrl,
      ]) => {
        const resolvedLangfuseHost = resolveLangfuseHost(
          langfuseHost,
          deployedLangfuseUrl,
        );
        const systemd = {
          databaseUrl: escapeSystemdUnitValue(databaseUrl),
          adminToken: escapeSystemdUnitValue(resolvedAdminToken),
          langfuseHost: escapeSystemdUnitValue(resolvedLangfuseHost),
          langfusePublicKey: escapeSystemdUnitValue(resolvedLangfusePublicKey),
          langfuseSecretKey: escapeSystemdUnitValue(resolvedLangfuseSecretKey),
          azureApiKey: escapeSystemdUnitValue(resolvedAzureApiKey ?? ""),
          mistralApiKey: escapeSystemdUnitValue(resolvedMistralApiKey ?? ""),
          azureFoundryOcrApiKey: escapeSystemdUnitValue(
            resolvedAzureFoundryOcrApiKey ?? "",
          ),
          azureFoundryOcrApiUrl: escapeSystemdUnitValue(azureFoundryOcrApiUrl),
          azureFoundryOcrModel: escapeSystemdUnitValue(azureFoundryOcrModel),
          mistralDirectOcrApiKey: escapeSystemdUnitValue(
            resolvedMistralDirectOcrApiKey ?? "",
          ),
          mistralDirectOcrApiUrl: escapeSystemdUnitValue(
            mistralDirectOcrApiUrl,
          ),
          mistralDirectOcrModel: escapeSystemdUnitValue(mistralDirectOcrModel),
          mistralApiUrl: escapeSystemdUnitValue(mistralApiUrl),
          mistralModel: escapeSystemdUnitValue(mistralModel),
          mistralTimeoutMs: escapeSystemdUnitValue(mistralTimeoutMs),
          ocrProvider: escapeSystemdUnitValue(ocrProvider),
          ocrTimeoutMs: escapeSystemdUnitValue(ocrTimeoutMs),
          zoneOcrFallbackEnabled: escapeSystemdUnitValue(
            zoneOcrFallbackEnabled,
          ),
          zoneOcrDpi: escapeSystemdUnitValue(zoneOcrDpi),
          zoneOcrRenderTimeoutMs: escapeSystemdUnitValue(
            zoneOcrRenderTimeoutMs,
          ),
          zoneOcrMaxZonesPerPage: escapeSystemdUnitValue(
            zoneOcrMaxZonesPerPage,
          ),
          zoneOcrSinglePageRescueEnabled: escapeSystemdUnitValue(
            zoneOcrSinglePageRescueEnabled,
          ),
          persistenceReconcileEnabled: escapeSystemdUnitValue(
            persistenceReconcileEnabled,
          ),
          persistenceReconcileIntervalMs: escapeSystemdUnitValue(
            persistenceReconcileIntervalMs,
          ),
        };

        return `#!/bin/bash
set -euo pipefail
yum update -y
yum install -y docker amazon-cloudwatch-agent
systemctl enable docker
systemctl start docker
aws ecr get-login-password --region ${ctx.region} | docker login --username AWS --password-stdin ${workerImageRegistry}
${logging.setupCommands}

cat >/etc/systemd/system/taxtrack-worker.service <<SERVICE
[Unit]
Description=TaxTrack Async Worker
After=docker.service
Requires=docker.service
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker rm -f taxtrack-worker
ExecStartPre=/bin/sh -c '/usr/bin/aws ecr get-login-password --region ${ctx.region} | /usr/bin/docker login --username AWS --password-stdin ${workerImageRegistry}'
ExecStartPre=/usr/bin/docker pull ${workerImageUri}
ExecStart=/usr/bin/docker run --name taxtrack-worker \\
  -p 3001:3001 \\
  -e AWS_REGION=${ctx.region} \\
  -e SQS_QUEUE_URL=${queueUrl} \\
  -e S3_BUCKET_NAME=${bucket} \\
  -e S3_OBJECT_PREFIX=v2 \\
  -e DATABASE_URL='${systemd.databaseUrl}' \\
  -e PGSSLMODE='require' \\
  -e ADMIN_TOKEN='${systemd.adminToken}' \\
  -e LANGFUSE_ENABLED=true \\
  -e LANGFUSE_HOST='${systemd.langfuseHost}' \\
  -e LANGFUSE_PUBLIC_KEY='${systemd.langfusePublicKey}' \\
  -e LANGFUSE_SECRET_KEY='${systemd.langfuseSecretKey}' \\
  -e AZURE_API_KEY='${systemd.azureApiKey}' \\
  -e MISTRAL_API_KEY='${systemd.mistralApiKey}' \\
  -e OCR_PROVIDER='${systemd.ocrProvider}' \\
  -e OCR_TIMEOUT_MS='${systemd.ocrTimeoutMs}' \\
  -e AZURE_FOUNDRY_OCR_API_KEY='${systemd.azureFoundryOcrApiKey}' \\
  -e AZURE_FOUNDRY_OCR_API_URL='${systemd.azureFoundryOcrApiUrl}' \\
  -e AZURE_FOUNDRY_OCR_MODEL='${systemd.azureFoundryOcrModel}' \\
  -e MISTRAL_DIRECT_OCR_API_KEY='${systemd.mistralDirectOcrApiKey}' \\
  -e MISTRAL_DIRECT_OCR_API_URL='${systemd.mistralDirectOcrApiUrl}' \\
  -e MISTRAL_DIRECT_OCR_MODEL='${systemd.mistralDirectOcrModel}' \\
  -e MISTRAL_API_URL='${systemd.mistralApiUrl}' \\
  -e MISTRAL_MODEL='${systemd.mistralModel}' \\
  -e MISTRAL_TIMEOUT_MS='${systemd.mistralTimeoutMs}' \\
  -e ZONE_OCR_FALLBACK_ENABLED='${systemd.zoneOcrFallbackEnabled}' \\
  -e ZONE_OCR_DPI='${systemd.zoneOcrDpi}' \\
  -e ZONE_OCR_RENDER_TIMEOUT_MS='${systemd.zoneOcrRenderTimeoutMs}' \\
  -e ZONE_OCR_MAX_ZONES_PER_PAGE='${systemd.zoneOcrMaxZonesPerPage}' \\
  -e ZONE_OCR_SINGLE_PAGE_RESCUE_ENABLED='${systemd.zoneOcrSinglePageRescueEnabled}' \\
  -e PERSISTENCE_RECONCILE_ENABLED='${systemd.persistenceReconcileEnabled}' \\
  -e PERSISTENCE_RECONCILE_INTERVAL_MS='${systemd.persistenceReconcileIntervalMs}' \\
  -e WORKER_CONCURRENCY=${input.sizing.worker.concurrency} \\
  -e SQS_WAIT_TIME_SECONDS=20 \\
  -e SQS_VISIBILITY_TIMEOUT_SECONDS=300 \\
  ${workerImageUri}
ExecStop=/usr/bin/docker stop taxtrack-worker

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable taxtrack-worker
systemctl restart taxtrack-worker
`;
      },
    );

  const instanceSpecs = buildWorkerInstanceSpecs(
    ctx.namePrefix,
    input.sizing.worker.count,
    [input.network.privateSubnet.id, input.network.privateSubnet2.id],
  );
  const instances = instanceSpecs.map(
    (spec) =>
      new aws.ec2.Instance(spec.logicalName, {
        ami: ami.id,
        instanceType: input.sizing.worker.instanceType,
        subnetId: spec.subnetId,
        vpcSecurityGroupIds: [input.network.workerSg.id],
        iamInstanceProfile: profile.name,
        userDataReplaceOnChange: true,
        userData,
        tags: {
          Name: spec.nameTag,
          TaxTrackStage: ctx.stage,
          TaxTrackWorkerOrdinal: String(spec.ordinal),
        },
      }),
  );
  const instance = instances[0];
  if (!instance) {
    throw new Error("At least one worker instance is required.");
  }

  return {
    instance,
    instances,
  };
}
