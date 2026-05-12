import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { requiredSecret } from "./config";
import { enableEc2CloudWatchLogging } from "./ec2-cloudwatch-logging";
import type { InfraSizing } from "./sizing";
import type { InfraContext, NetworkResources } from "./types";

export function createLangfuseCompute(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    sizing: InfraSizing;
  },
) {
  const langfusePublicKey = requiredSecret(
    "langfusePublicKey",
    "TAXTRACK_LANGFUSE_PUBLIC_KEY",
  );
  const langfuseSecretKey = requiredSecret(
    "langfuseSecretKey",
    "TAXTRACK_LANGFUSE_SECRET_KEY",
  );
  const langfuseSalt = requiredSecret("langfuseSalt", "TAXTRACK_LANGFUSE_SALT");

  const role = new aws.iam.Role(`${ctx.namePrefix}-langfuse-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-langfuse-ssm`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore,
  });

  const logging = enableEc2CloudWatchLogging(ctx, {
    role,
    service: "langfuse",
  });

  const profile = new aws.iam.InstanceProfile(
    `${ctx.namePrefix}-langfuse-profile`,
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
    .all([langfusePublicKey, langfuseSecretKey, langfuseSalt])
    .apply(
      ([publicKey, secretKey, salt]) => `#!/bin/bash
set -euo pipefail
yum update -y
yum install -y docker git amazon-cloudwatch-agent
systemctl enable docker
systemctl start docker
${logging.setupCommands}
mkdir -p /opt/langfuse
cd /opt/langfuse
curl -fsSL https://raw.githubusercontent.com/langfuse/langfuse/main/docker-compose.yml -o docker-compose.yml
cat > .env <<ENV
NEXTAUTH_SECRET=${salt}
SALT=${salt}
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_REGION=${ctx.region}
LANGFUSE_INIT_ORG_ID=taxtrack
LANGFUSE_INIT_ORG_NAME=TaxTrack
LANGFUSE_INIT_PROJECT_ID=taxtrack-${ctx.stage}
LANGFUSE_INIT_PROJECT_NAME=TaxTrack ${ctx.stage}
LANGFUSE_INIT_PROJECT_PUBLIC_KEY=${publicKey}
LANGFUSE_INIT_PROJECT_SECRET_KEY=${secretKey}
ENV
docker compose pull
docker compose up -d
`,
    );

  const instance = new aws.ec2.Instance(`${ctx.namePrefix}-langfuse-ec2`, {
    ami: ami.id,
    instanceType: input.sizing.langfuse.instanceType,
    subnetId: input.network.publicSubnet.id,
    vpcSecurityGroupIds: [input.network.langfuseSg.id],
    iamInstanceProfile: profile.name,
    userDataReplaceOnChange: true,
    userData,
    rootBlockDevice: {
      volumeSize: input.sizing.langfuse.rootVolumeGb,
      volumeType: "gp3",
    },
    tags: {
      Name: `${ctx.namePrefix}-langfuse`,
    },
  });

  const eip = new aws.ec2.Eip(`${ctx.namePrefix}-langfuse-eip`, {
    domain: "vpc",
    instance: instance.id,
  });

  new aws.cloudwatch.MetricAlarm(`${ctx.namePrefix}-langfuse-status-alarm`, {
    alarmDescription: "Langfuse EC2 status check",
    namespace: "AWS/EC2",
    metricName: "StatusCheckFailed",
    statistic: "Maximum",
    period: 60,
    evaluationPeriods: 2,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    dimensions: {
      InstanceId: instance.id,
    },
  });

  return {
    instance,
    eip,
    url: pulumi.interpolate`http://${eip.publicIp}:3000`,
  };
}
