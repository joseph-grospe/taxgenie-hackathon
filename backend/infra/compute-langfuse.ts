import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { optionalString, requiredSecret, requiredString } from "./config";
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
  const langfuseInitUserEmail = requiredString(
    "langfuseInitUserEmail",
    "TAXTRACK_LANGFUSE_INIT_USER_EMAIL",
  );
  const langfuseInitUserName = optionalString(
    "langfuseInitUserName",
    "TAXTRACK_LANGFUSE_INIT_USER_NAME",
  );
  const langfuseInitUserPassword = requiredSecret(
    "langfuseInitUserPassword",
    "TAXTRACK_LANGFUSE_INIT_USER_PASSWORD",
  );

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

  const eip = new aws.ec2.Eip(`${ctx.namePrefix}-langfuse-eip`, {
    domain: "vpc",
  });

  const userData = pulumi
    .all([
      langfusePublicKey,
      langfuseSecretKey,
      langfuseSalt,
      langfuseInitUserPassword,
      eip.publicIp,
    ])
    .apply(
      ([publicKey, secretKey, salt, initUserPassword, publicIp]) => `#!/bin/bash
set -euo pipefail
yum update -y
yum install -y docker git amazon-cloudwatch-agent
systemctl enable docker
systemctl start docker
${logging.setupCommands}
COMPOSE_VERSION=v2.27.0
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) COMPOSE_ARCH=x86_64 ;;
  aarch64) COMPOSE_ARCH=aarch64 ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/\${COMPOSE_VERSION}/docker-compose-linux-\${COMPOSE_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
mkdir -p /opt/langfuse
cd /opt/langfuse
curl -fsSL https://raw.githubusercontent.com/langfuse/langfuse/main/docker-compose.yml -o docker-compose.yml
cat > .env <<ENV
NEXTAUTH_SECRET=${salt}
NEXTAUTH_URL=http://${publicIp}:3000
SALT=${salt}
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_REGION=${ctx.region}
LANGFUSE_INIT_ORG_ID=taxtrack
LANGFUSE_INIT_ORG_NAME=TaxTrack
LANGFUSE_INIT_PROJECT_ID=taxtrack-${ctx.stage}
LANGFUSE_INIT_PROJECT_NAME=TaxTrack ${ctx.stage}
LANGFUSE_INIT_PROJECT_PUBLIC_KEY=${publicKey}
LANGFUSE_INIT_PROJECT_SECRET_KEY=${secretKey}
LANGFUSE_INIT_USER_EMAIL=${langfuseInitUserEmail}
${langfuseInitUserName ? `LANGFUSE_INIT_USER_NAME=${langfuseInitUserName}\n` : ""}LANGFUSE_INIT_USER_PASSWORD=${initUserPassword}
LANGFUSE_DEFAULT_ORG_ID=taxtrack
LANGFUSE_DEFAULT_ORG_ROLE=OWNER
LANGFUSE_DEFAULT_PROJECT_ID=taxtrack-${ctx.stage}
LANGFUSE_DEFAULT_PROJECT_ROLE=OWNER
ENV
cat > docker-compose.override.yml <<'YAML'
services:
  langfuse-web:
    environment:
      LANGFUSE_DEFAULT_ORG_ID: \${LANGFUSE_DEFAULT_ORG_ID:-}
      LANGFUSE_DEFAULT_ORG_ROLE: \${LANGFUSE_DEFAULT_ORG_ROLE:-VIEWER}
      LANGFUSE_DEFAULT_PROJECT_ID: \${LANGFUSE_DEFAULT_PROJECT_ID:-}
      LANGFUSE_DEFAULT_PROJECT_ROLE: \${LANGFUSE_DEFAULT_PROJECT_ROLE:-VIEWER}
  langfuse-worker:
    environment:
      LANGFUSE_DEFAULT_ORG_ID: \${LANGFUSE_DEFAULT_ORG_ID:-}
      LANGFUSE_DEFAULT_ORG_ROLE: \${LANGFUSE_DEFAULT_ORG_ROLE:-VIEWER}
      LANGFUSE_DEFAULT_PROJECT_ID: \${LANGFUSE_DEFAULT_PROJECT_ID:-}
      LANGFUSE_DEFAULT_PROJECT_ROLE: \${LANGFUSE_DEFAULT_PROJECT_ROLE:-VIEWER}
YAML
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

  new aws.ec2.EipAssociation(`${ctx.namePrefix}-langfuse-eip-association`, {
    allocationId: eip.id,
    instanceId: instance.id,
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
    privateUrl: pulumi.interpolate`http://${instance.privateIp}:3000`,
    url: pulumi.interpolate`http://${eip.publicIp}:3000`,
  };
}
