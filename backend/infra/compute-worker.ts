import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
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
  },
) {
  const workerImageUri = requiredString(
    "workerImageUri",
    "TAXGENIE_WORKER_IMAGE_URI",
  );
  if (workerImageUri === "replace-me" || !workerImageUri.includes("/")) {
    throw new Error(
      "TAXGENIE_WORKER_IMAGE_URI must be a fully qualified image URI before deploying the worker.",
    );
  }
  const workerImageRegistry = workerImageUri.split("/")[0];
  const adminToken = requiredSecret(
    "workerAdminToken",
    "TAXGENIE_WORKER_ADMIN_TOKEN",
  );
  const langsmithApiKey = requiredSecret(
    "langsmithApiKey",
    "TAXGENIE_LANGSMITH_API_KEY",
  );
  const langsmithEndpoint =
    optionalString("langsmithEndpoint", "TAXGENIE_LANGSMITH_ENDPOINT") ??
    "https://apac.api.smith.langchain.com";
  const langsmithProject =
    optionalString("langsmithProject", "TAXGENIE_LANGSMITH_PROJECT") ??
    `taxgenie-${ctx.stage}`;
  const geminiApiKey = requiredSecret("geminiApiKey", "GEMINI_API_KEY");
  const geminiModel =
    optionalString("geminiModel", "GEMINI_MODEL") ??
    "gemini-3-flash-preview";
  const geminiThinkingLevel =
    optionalString("geminiThinkingLevel", "GEMINI_THINKING_LEVEL") ?? "high";
  const geminiMediaResolution =
    optionalString("geminiMediaResolution", "GEMINI_MEDIA_RESOLUTION") ??
    "medium";
  const geminiTimeoutMs =
    optionalString("geminiTimeoutMs", "GEMINI_TIMEOUT_MS") ?? "180000";
  const signatureVisualDetectorEnabled =
    optionalString(
      "signatureVisualDetectorEnabled",
      "SIGNATURE_VISUAL_DETECTOR_ENABLED",
    ) ?? "true";
  const signatureVisualMinConfidence =
    optionalString(
      "signatureVisualMinConfidence",
      "SIGNATURE_VISUAL_MIN_CONFIDENCE",
    ) ?? "0.86";
  const signatureVisualDpi =
    optionalString("signatureVisualDpi", "SIGNATURE_VISUAL_DPI") ?? "400";
  const signatureVisualTimeoutMs =
    optionalString(
      "signatureVisualTimeoutMs",
      "SIGNATURE_VISUAL_TIMEOUT_MS",
    ) ?? "60000";
  const pdfTextLayerFallbackEnabled =
    optionalString(
      "pdfTextLayerFallbackEnabled",
      "PDF_TEXT_LAYER_FALLBACK_ENABLED",
    ) ?? "true";
  const payorSignerVerificationEnabled =
    optionalString(
      "payorSignerVerificationEnabled",
      "PAYOR_SIGNER_VERIFICATION_ENABLED",
    ) ?? "false";
  const identityConfidenceFlowEnabled =
    optionalString(
      "identityConfidenceFlowEnabled",
      "IDENTITY_CONFIDENCE_FLOW_ENABLED",
    ) ?? "true";
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
        namespace: `TaxGenie/${ctx.stage}/Worker`,
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
      langsmithApiKey,
      geminiApiKey,
    ])
    .apply(
      ([
        queueUrl,
        bucket,
        databaseUrl,
        resolvedAdminToken,
        resolvedLangsmithApiKey,
        resolvedGeminiApiKey,
      ]) => {
        const systemd = {
          databaseUrl: escapeSystemdUnitValue(databaseUrl),
          adminToken: escapeSystemdUnitValue(resolvedAdminToken),
          langsmithApiKey: escapeSystemdUnitValue(resolvedLangsmithApiKey),
          langsmithEndpoint: escapeSystemdUnitValue(langsmithEndpoint),
          langsmithProject: escapeSystemdUnitValue(langsmithProject),
          geminiApiKey: escapeSystemdUnitValue(resolvedGeminiApiKey),
          geminiModel: escapeSystemdUnitValue(geminiModel),
          geminiThinkingLevel: escapeSystemdUnitValue(geminiThinkingLevel),
          geminiMediaResolution: escapeSystemdUnitValue(
            geminiMediaResolution,
          ),
          geminiTimeoutMs: escapeSystemdUnitValue(geminiTimeoutMs),
          signatureVisualDetectorEnabled: escapeSystemdUnitValue(
            signatureVisualDetectorEnabled,
          ),
          signatureVisualMinConfidence: escapeSystemdUnitValue(
            signatureVisualMinConfidence,
          ),
          signatureVisualDpi: escapeSystemdUnitValue(signatureVisualDpi),
          signatureVisualTimeoutMs: escapeSystemdUnitValue(
            signatureVisualTimeoutMs,
          ),
          pdfTextLayerFallbackEnabled: escapeSystemdUnitValue(
            pdfTextLayerFallbackEnabled,
          ),
          payorSignerVerificationEnabled: escapeSystemdUnitValue(
            payorSignerVerificationEnabled,
          ),
          identityConfidenceFlowEnabled: escapeSystemdUnitValue(
            identityConfidenceFlowEnabled,
          ),
        };

        return `#!/bin/bash
set -euo pipefail
yum update -y
yum install -y docker amazon-cloudwatch-agent
systemctl enable docker
systemctl start docker
${logging.setupCommands}

cat >/etc/systemd/system/taxgenie-worker.service <<SERVICE
[Unit]
Description=TaxGenie Async Worker
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker rm -f taxgenie-worker
ExecStartPre=/bin/sh -c '/usr/bin/aws ecr get-login-password --region ${ctx.region} | /usr/bin/docker login --username AWS --password-stdin ${workerImageRegistry}'
ExecStartPre=/usr/bin/docker pull ${workerImageUri}
ExecStart=/usr/bin/docker run --name taxgenie-worker \\
  -p 3001:3001 \\
  -e AWS_REGION=${ctx.region} \\
  -e SQS_QUEUE_URL=${queueUrl} \\
  -e S3_BUCKET_NAME=${bucket} \\
  -e S3_OBJECT_PREFIX=v2 \\
  -e DATABASE_URL='${systemd.databaseUrl}' \\
  -e PGSSLMODE='require' \\
  -e ADMIN_TOKEN='${systemd.adminToken}' \\
  -e TAXGENIE_LANGSMITH_ENABLED=true \\
  -e LANGSMITH_API_KEY='${systemd.langsmithApiKey}' \\
  -e LANGSMITH_ENDPOINT='${systemd.langsmithEndpoint}' \\
  -e LANGSMITH_PROJECT='${systemd.langsmithProject}' \\
  -e LANGCHAIN_CALLBACKS_BACKGROUND=true \\
  -e GEMINI_API_KEY='${systemd.geminiApiKey}' \\
  -e GEMINI_MODEL='${systemd.geminiModel}' \\
  -e GEMINI_THINKING_LEVEL='${systemd.geminiThinkingLevel}' \\
  -e GEMINI_MEDIA_RESOLUTION='${systemd.geminiMediaResolution}' \\
  -e GEMINI_TIMEOUT_MS='${systemd.geminiTimeoutMs}' \\
  -e SIGNATURE_VISUAL_DETECTOR_ENABLED='${systemd.signatureVisualDetectorEnabled}' \\
  -e SIGNATURE_VISUAL_MIN_CONFIDENCE='${systemd.signatureVisualMinConfidence}' \\
  -e SIGNATURE_VISUAL_DPI='${systemd.signatureVisualDpi}' \\
  -e SIGNATURE_VISUAL_TIMEOUT_MS='${systemd.signatureVisualTimeoutMs}' \\
  -e PDF_TEXT_LAYER_FALLBACK_ENABLED='${systemd.pdfTextLayerFallbackEnabled}' \\
  -e PAYOR_SIGNER_VERIFICATION_ENABLED='${systemd.payorSignerVerificationEnabled}' \\
  -e IDENTITY_CONFIDENCE_FLOW_ENABLED='${systemd.identityConfidenceFlowEnabled}' \\
  -e WORKER_CONCURRENCY=${input.sizing.worker.concurrency} \\
  -e SQS_WAIT_TIME_SECONDS=20 \\
  -e SQS_VISIBILITY_TIMEOUT_SECONDS=300 \\
  ${workerImageUri}
ExecStop=/usr/bin/docker stop taxgenie-worker

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable taxgenie-worker
systemctl start --no-block taxgenie-worker
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
          TaxGenieStage: ctx.stage,
          TaxGenieWorkerOrdinal: String(spec.ordinal),
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
