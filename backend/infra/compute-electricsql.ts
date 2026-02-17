import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { requiredSecret, requiredString } from "./config";
import type { DataResources, InfraContext, NetworkResources } from "./types";

export function createElectricSqlCompute(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    data: DataResources;
  }
) {
  const electricSqlImageUri = requiredString("electricSqlImageUri", "TAXTRACK_ELECTRICSQL_IMAGE_URI");
  const dbPassword = requiredSecret("dbPassword", "TAXTRACK_DB_PASSWORD");

  const role = new aws.iam.Role(`${ctx.namePrefix}-electricsql-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com"
    })
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-electricsql-ssm`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore
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
      input.data.db.address,
      input.data.db.port,
      input.data.db.username,
      input.data.db.dbName,
      dbPassword
    ])
    .apply(([dbAddress, dbPort, dbUser, dbName, resolvedDbPassword]) => {
      const databaseUrl = `postgresql://${dbUser}:${resolvedDbPassword}@${dbAddress}:${dbPort}/${dbName}`;
      return `#!/bin/bash
set -euo pipefail
yum update -y
yum install -y docker
systemctl enable docker
systemctl start docker

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
    subnetId: input.network.privateSubnet.id,
    vpcSecurityGroupIds: [input.network.electricSqlSg.id],
    iamInstanceProfile: profile.name,
    userData
  });

  return {
    instance
  };
}
