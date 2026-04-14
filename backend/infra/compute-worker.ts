import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { optionalString, requiredSecret, requiredString } from "./config";
import { enableEc2CloudWatchLogging } from "./ec2-cloudwatch-logging";
import type { DataResources, InfraContext, NetworkResources, QueueResources } from "./types";

export function createWorkerCompute(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    queue: QueueResources;
    data: DataResources;
  }
) {
  const workerImageUri = requiredString("workerImageUri", "TAXTRACK_WORKER_IMAGE_URI");
  if (workerImageUri === "replace-me" || !workerImageUri.includes("/")) {
    throw new Error(
      "TAXTRACK_WORKER_IMAGE_URI must be a fully qualified image URI before deploying the worker."
    );
  }
  const workerImageRegistry = workerImageUri.split("/")[0];
  const adminToken = requiredSecret("workerAdminToken", "TAXTRACK_WORKER_ADMIN_TOKEN");
  const langfuseHost = optionalString("langfuseHost", "TAXTRACK_LANGFUSE_HOST");
  const langfusePublicKey = requiredSecret("langfusePublicKey", "TAXTRACK_LANGFUSE_PUBLIC_KEY");
  const langfuseSecretKey = requiredSecret("langfuseSecretKey", "TAXTRACK_LANGFUSE_SECRET_KEY");

  const role = new aws.iam.Role(`${ctx.namePrefix}-worker-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com"
    })
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-worker-ssm`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore
  });

  const logging = enableEc2CloudWatchLogging(ctx, {
    role,
    service: "worker"
  });

  new aws.iam.RolePolicy(`${ctx.namePrefix}-worker-policy`, {
    role: role.id,
    policy: pulumi
      .all([
        input.queue.queue.arn,
        input.queue.dlq.arn,
        input.data.artifactsBucket.arn,
        input.data.sourceFilesBucket.arn
      ])
      .apply(([queueArn, dlqArn, artifactsBucketArn, sourceFilesBucketArn]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes",
                "sqs:ChangeMessageVisibility"
              ],
              Resource: [queueArn, dlqArn]
            },
            {
              Effect: "Allow",
              Action: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer"
              ],
              Resource: "*"
            },
            {
              Effect: "Allow",
              Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
              Resource: [artifactsBucketArn, `${artifactsBucketArn}/*`]
            },
            {
              Effect: "Allow",
              Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
              Resource: [sourceFilesBucketArn, `${sourceFilesBucketArn}/*`]
            }
          ]
        })
      )
  });

  const profile = new aws.iam.InstanceProfile(`${ctx.namePrefix}-worker-profile`, {
    role: role.name
  });

  const ami = aws.ec2.getAmiOutput({
    owners: ["amazon"],
    mostRecent: true,
    filters: [
      {
        name: "name",
        values: ["al2023-ami-2023*-x86_64"]
      }
    ]
  });

  const userData = pulumi
    .all([
      input.queue.queue.url,
      input.data.artifactsBucket.bucket,
      input.data.sourceFilesBucket.bucket,
      input.data.databaseUrl,
      adminToken,
      langfusePublicKey,
      langfuseSecretKey
    ])
    .apply(
      ([
        queueUrl,
        bucket,
        sourceBucket,
        databaseUrl,
        resolvedAdminToken,
        resolvedLangfusePublicKey,
        resolvedLangfuseSecretKey
      ]) => {
        const resolvedLangfuseHost = langfuseHost ?? "";

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

[Service]
Restart=always
ExecStartPre=-/usr/bin/docker rm -f taxtrack-worker
ExecStart=/usr/bin/docker run --name taxtrack-worker \\
  -p 3001:3001 \\
  -e AWS_REGION=${ctx.region} \\
  -e SQS_QUEUE_URL=${queueUrl} \\
  -e S3_BUCKET=${bucket} \\
  -e S3_SOURCE_BUCKET=${sourceBucket} \\
  -e DATABASE_URL='${databaseUrl}' \\
  -e PGSSLMODE='require' \\
  -e ADMIN_TOKEN='${resolvedAdminToken}' \\
  -e LANGFUSE_ENABLED=true \\
  -e LANGFUSE_HOST='${resolvedLangfuseHost}' \\
  -e LANGFUSE_PUBLIC_KEY='${resolvedLangfusePublicKey}' \\
  -e LANGFUSE_SECRET_KEY='${resolvedLangfuseSecretKey}' \\
  -e WORKER_CONCURRENCY=2 \\
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
      }
    );

  const instance = new aws.ec2.Instance(`${ctx.namePrefix}-worker-ec2`, {
    ami: ami.id,
    instanceType: "t3.medium",
    subnetId: input.network.privateSubnet.id,
    vpcSecurityGroupIds: [input.network.workerSg.id],
    iamInstanceProfile: profile.name,
    userDataReplaceOnChange: true,
    userData
  });

  return {
    instance
  };
}
