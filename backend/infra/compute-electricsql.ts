import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { requiredString } from "./config";
import { enableEc2CloudWatchLogging } from "./ec2-cloudwatch-logging";
import type { DataResources, InfraContext, NetworkResources } from "./types";

export function createElectricSqlCompute(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    data: DataResources;
  }
) {
  const electricSqlImageUri = requiredString("electricSqlImageUri", "TAXTRACK_ELECTRICSQL_IMAGE_URI");

  const role = new aws.iam.Role(`${ctx.namePrefix}-electricsql-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com"
    })
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-electricsql-ssm`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore
  });

  const logging = enableEc2CloudWatchLogging(ctx, {
    role,
    service: "electricsql"
  });

  const profile = new aws.iam.InstanceProfile(`${ctx.namePrefix}-electricsql-profile`, {
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
      input.data.databaseUrl,
    ])
    .apply(([databaseUrl]) => {
      return `#!/bin/bash
set -euo pipefail
yum update -y
yum install -y docker amazon-cloudwatch-agent
systemctl enable docker
systemctl start docker
${logging.setupCommands}

cat >/etc/systemd/system/electricsql.service <<SERVICE
[Unit]
Description=ElectricSQL Sync Engine
After=docker.service
Requires=docker.service

[Service]
Restart=always
ExecStartPre=-/usr/bin/docker rm -f electricsql
ExecStart=/usr/bin/docker run --name electricsql \\
  -p 5133:5133 \\
  -e DATABASE_URL='${databaseUrl}' \\
  -e PGSSLMODE='require' \\
  -e ELECTRIC_INSECURE='true' \\
  ${electricSqlImageUri}
ExecStop=/usr/bin/docker stop electricsql

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable electricsql
systemctl restart electricsql
`;
    });

  const instance = new aws.ec2.Instance(`${ctx.namePrefix}-electricsql-ec2`, {
    ami: ami.id,
    instanceType: "t3.small",
    subnetId: input.network.publicSubnet.id,
    vpcSecurityGroupIds: [input.network.electricSqlSg.id],
    iamInstanceProfile: profile.name,
    userDataReplaceOnChange: true,
    userData
  });

  const loadBalancerSg = new aws.ec2.SecurityGroup(`${ctx.namePrefix}-electricsql-alb-sg`, {
    vpcId: input.network.vpc.id,
    description: "Public ElectricSQL load balancer security group",
    ingress: [
      {
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  });

  const loadBalancer = new aws.lb.LoadBalancer(`${ctx.namePrefix}-electricsql-alb`, {
    name: `${ctx.stage}-es-alb`.slice(0, 32),
    internal: false,
    loadBalancerType: "application",
    securityGroups: [loadBalancerSg.id],
    subnets: [input.network.publicSubnet.id, input.network.publicSubnet2.id],
  });

  const targetGroup = new aws.lb.TargetGroup(`${ctx.namePrefix}-electricsql-tg`, {
    name: `${ctx.stage}-es-tg`.slice(0, 32),
    vpcId: input.network.vpc.id,
    port: 5133,
    protocol: "HTTP",
    targetType: "instance",
    healthCheck: {
      enabled: true,
      path: "/",
      protocol: "HTTP",
      matcher: "200-499",
    },
  });

  new aws.lb.TargetGroupAttachment(`${ctx.namePrefix}-electricsql-target`, {
    targetGroupArn: targetGroup.arn,
    targetId: instance.id,
    port: 5133,
  });

  new aws.lb.Listener(`${ctx.namePrefix}-electricsql-listener`, {
    loadBalancerArn: loadBalancer.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      {
        type: "forward",
        targetGroupArn: targetGroup.arn,
      },
    ],
  });

  const cachePolicy = new aws.cloudfront.CachePolicy(`${ctx.namePrefix}-electricsql-cache-policy`, {
    name: `${ctx.namePrefix}-electricsql-cache-policy`,
    comment: "Disable caching for ElectricSQL sync traffic",
    defaultTtl: 0,
    maxTtl: 1,
    minTtl: 0,
    parametersInCacheKeyAndForwardedToOrigin: {
      cookiesConfig: {
        cookieBehavior: "none",
      },
      headersConfig: {
        headerBehavior: "none",
      },
      queryStringsConfig: {
        queryStringBehavior: "none",
      },
    },
  });

  const originRequestPolicy = new aws.cloudfront.OriginRequestPolicy(
    `${ctx.namePrefix}-electricsql-origin-policy`,
    {
      name: `${ctx.namePrefix}-electricsql-origin-policy`,
      comment: "Forward all viewer data to ElectricSQL origin",
      cookiesConfig: {
        cookieBehavior: "all",
      },
      headersConfig: {
        headerBehavior: "allViewer",
      },
      queryStringsConfig: {
        queryStringBehavior: "all",
      },
    },
  );

  const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
    `${ctx.namePrefix}-electricsql-response-policy`,
    {
      name: `${ctx.namePrefix}-electricsql-response-policy`,
      comment: "Allow browser access to ElectricSQL",
      corsConfig: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: {
          items: ["*"],
        },
        accessControlAllowMethods: {
          items: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
        },
        accessControlAllowOrigins: {
          items: ["*"],
        },
        originOverride: true,
      },
    },
  );

  const distribution = new aws.cloudfront.Distribution(`${ctx.namePrefix}-electricsql-cdn`, {
    enabled: true,
    isIpv6Enabled: true,
    origins: [
      {
        domainName: loadBalancer.dnsName,
        originId: "electricsql-origin",
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: "http-only",
          originSslProtocols: ["TLSv1.2"],
          originReadTimeout: 60,
          originKeepaliveTimeout: 60,
        },
      },
    ],
    defaultCacheBehavior: {
      targetOriginId: "electricsql-origin",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: [
        "DELETE",
        "GET",
        "HEAD",
        "OPTIONS",
        "PATCH",
        "POST",
        "PUT",
      ],
      cachedMethods: ["GET", "HEAD", "OPTIONS"],
      cachePolicyId: cachePolicy.id,
      originRequestPolicyId: originRequestPolicy.id,
      responseHeadersPolicyId: responseHeadersPolicy.id,
      compress: false,
    },
    restrictions: {
      geoRestriction: {
        restrictionType: "none",
      },
    },
    viewerCertificate: {
      cloudfrontDefaultCertificate: true,
    },
  });

  const url = pulumi.interpolate`https://${distribution.domainName}`;

  return {
    instance,
    distribution,
    url,
  };
}
