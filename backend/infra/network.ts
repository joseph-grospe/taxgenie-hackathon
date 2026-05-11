import * as aws from "@pulumi/aws";
import { optionalStringList } from "./config";
import type { InfraContext, NetworkResources } from "./types";

type CreateNetworkOptions = {
  enableNatInstance?: boolean;
  natInstanceType?: string;
};

export function createNetwork(
  ctx: InfraContext,
  options: CreateNetworkOptions = {},
): NetworkResources {
  const enableNatInstance = options.enableNatInstance ?? true;
  const natInstanceType = options.natInstanceType ?? "t3.micro";
  const primaryAz = process.env.TAXTRACK_AZ_PRIMARY ?? `${ctx.region}a`;
  const secondaryAz = process.env.TAXTRACK_AZ_SECONDARY ?? `${ctx.region}b`;

  const vpc = new aws.ec2.Vpc(`${ctx.namePrefix}-vpc`, {
    cidrBlock: "10.42.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: {
      Name: `${ctx.namePrefix}-vpc`,
    },
  });

  const internetGateway = new aws.ec2.InternetGateway(`${ctx.namePrefix}-igw`, {
    vpcId: vpc.id,
    tags: {
      Name: `${ctx.namePrefix}-igw`,
    },
  });

  const publicSubnet = new aws.ec2.Subnet(`${ctx.namePrefix}-public-subnet`, {
    vpcId: vpc.id,
    cidrBlock: "10.42.0.0/24",
    availabilityZone: primaryAz,
    mapPublicIpOnLaunch: true,
    tags: {
      Name: `${ctx.namePrefix}-public-subnet`,
    },
  });

  const publicSubnet2 = new aws.ec2.Subnet(
    `${ctx.namePrefix}-public-subnet-2`,
    {
      vpcId: vpc.id,
      cidrBlock: "10.42.3.0/24",
      availabilityZone: secondaryAz,
      mapPublicIpOnLaunch: true,
      tags: {
        Name: `${ctx.namePrefix}-public-subnet-2`,
      },
    },
  );

  const privateSubnet = new aws.ec2.Subnet(`${ctx.namePrefix}-private-subnet`, {
    vpcId: vpc.id,
    cidrBlock: "10.42.1.0/24",
    availabilityZone: primaryAz,
    mapPublicIpOnLaunch: false,
    tags: {
      Name: `${ctx.namePrefix}-private-subnet`,
    },
  });

  const privateSubnet2 = new aws.ec2.Subnet(
    `${ctx.namePrefix}-private-subnet-2`,
    {
      vpcId: vpc.id,
      cidrBlock: "10.42.2.0/24",
      availabilityZone: secondaryAz,
      mapPublicIpOnLaunch: false,
      tags: {
        Name: `${ctx.namePrefix}-private-subnet-2`,
      },
    },
  );

  const publicRouteTable = new aws.ec2.RouteTable(
    `${ctx.namePrefix}-public-rt`,
    {
      vpcId: vpc.id,
      routes: [
        {
          cidrBlock: "0.0.0.0/0",
          gatewayId: internetGateway.id,
        },
      ],
    },
  );

  new aws.ec2.RouteTableAssociation(`${ctx.namePrefix}-public-rta`, {
    subnetId: publicSubnet.id,
    routeTableId: publicRouteTable.id,
  });

  new aws.ec2.RouteTableAssociation(`${ctx.namePrefix}-public-rta-2`, {
    subnetId: publicSubnet2.id,
    routeTableId: publicRouteTable.id,
  });

  const privateRouteTableRoutes: aws.types.input.ec2.RouteTableRoute[] = [];
  if (enableNatInstance) {
    const natSg = new aws.ec2.SecurityGroup(`${ctx.namePrefix}-nat-sg`, {
      vpcId: vpc.id,
      description: "Security group for NAT instance",
      ingress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["10.42.0.0/16"],
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

    const natAmi = aws.ec2.getAmiOutput({
      owners: ["amazon"],
      mostRecent: true,
      filters: [
        {
          name: "name",
          values: ["al2023-ami-2023*-x86_64"],
        },
      ],
    });

    const natInstance = new aws.ec2.Instance(`${ctx.namePrefix}-nat`, {
      ami: natAmi.id,
      subnetId: publicSubnet.id,
      instanceType: natInstanceType,
      vpcSecurityGroupIds: [natSg.id],
      sourceDestCheck: false,
      associatePublicIpAddress: true,
      userDataReplaceOnChange: true,
      userData: `#!/bin/bash
set -euo pipefail
dnf install -y iptables-services
PRIMARY_IFACE="$(ip route show default | awk '/default/ {print $5; exit}')"
cat >/etc/sysctl.d/99-taxtrack-nat.conf <<'CONF'
net.ipv4.ip_forward = 1
CONF
sysctl --system
iptables -t nat -C POSTROUTING -o "$PRIMARY_IFACE" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o "$PRIMARY_IFACE" -j MASQUERADE
iptables -C FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -C FORWARD -s 10.42.0.0/16 -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -s 10.42.0.0/16 -j ACCEPT
service iptables save
systemctl enable iptables
systemctl restart iptables
`,
      tags: {
        Name: `${ctx.namePrefix}-nat`,
      },
    });

    privateRouteTableRoutes.push({
      cidrBlock: "0.0.0.0/0",
      networkInterfaceId: natInstance.primaryNetworkInterfaceId,
    });
  }

  const privateRouteTable = new aws.ec2.RouteTable(
    `${ctx.namePrefix}-private-rt`,
    {
      vpcId: vpc.id,
      routes: privateRouteTableRoutes,
    },
  );

  new aws.ec2.VpcEndpoint(`${ctx.namePrefix}-s3-endpoint`, {
    vpcId: vpc.id,
    serviceName: `com.amazonaws.${ctx.region}.s3`,
    vpcEndpointType: "Gateway",
    routeTableIds: [privateRouteTable.id],
    tags: {
      Name: `${ctx.namePrefix}-s3-endpoint`,
    },
  });

  new aws.ec2.RouteTableAssociation(`${ctx.namePrefix}-private-rta`, {
    subnetId: privateSubnet.id,
    routeTableId: privateRouteTable.id,
  });

  new aws.ec2.RouteTableAssociation(`${ctx.namePrefix}-private-rta-2`, {
    subnetId: privateSubnet2.id,
    routeTableId: privateRouteTable.id,
  });

  const lambdaSg = new aws.ec2.SecurityGroup(`${ctx.namePrefix}-lambda-sg`, {
    vpcId: vpc.id,
    description: "App intake security group",
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  });

  const workerSg = new aws.ec2.SecurityGroup(`${ctx.namePrefix}-worker-sg`, {
    vpcId: vpc.id,
    description: "Worker EC2 security group",
    ingress: [
      {
        fromPort: 3001,
        toPort: 3001,
        protocol: "tcp",
        cidrBlocks: ["10.42.0.0/16"],
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

  const mergeBatchSg = new aws.ec2.SecurityGroup(
    `${ctx.namePrefix}-merge-batch-sg`,
    {
      vpcId: vpc.id,
      description: "AWS Batch Fargate merge job security group",
      egress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
    },
  );

  const ssmEndpointSg = new aws.ec2.SecurityGroup(
    `${ctx.namePrefix}-ssm-endpoint-sg`,
    {
      vpcId: vpc.id,
      description: "Security group for SSM VPC interface endpoints",
      ingress: [
        {
          fromPort: 443,
          toPort: 443,
          protocol: "tcp",
          securityGroups: [lambdaSg.id, workerSg.id],
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
    },
  );

  // Private worker instances need explicit SSM endpoints when they do not have
  // direct internet egress; public instances like Langfuse/ElectricSQL can reach
  // the same APIs over the internet gateway.
  for (const service of ["ssm", "ssmmessages", "ec2messages"]) {
    new aws.ec2.VpcEndpoint(`${ctx.namePrefix}-${service}-endpoint`, {
      vpcId: vpc.id,
      serviceName: `com.amazonaws.${ctx.region}.${service}`,
      vpcEndpointType: "Interface",
      privateDnsEnabled: true,
      securityGroupIds: [ssmEndpointSg.id],
      subnetIds: [privateSubnet.id, privateSubnet2.id],
      tags: {
        Name: `${ctx.namePrefix}-${service}-endpoint`,
      },
    });
  }

  const rdsSg = new aws.ec2.SecurityGroup(`${ctx.namePrefix}-rds-sg`, {
    vpcId: vpc.id,
    description: "RDS Postgres security group",
    ingress: [
      {
        fromPort: 5432,
        toPort: 5432,
        protocol: "tcp",
        securityGroups: [lambdaSg.id, workerSg.id, mergeBatchSg.id],
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

  const electricSqlSg = new aws.ec2.SecurityGroup(
    `${ctx.namePrefix}-electricsql-sg`,
    {
      vpcId: vpc.id,
      description: "ElectricSQL EC2 security group",
      ingress: [
        {
          fromPort: 5133,
          toPort: 5133,
          protocol: "tcp",
          cidrBlocks: ["10.42.0.0/16"],
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
    },
  );

  new aws.ec2.SecurityGroupRule(`${ctx.namePrefix}-rds-electricsql-ingress`, {
    type: "ingress",
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    securityGroupId: rdsSg.id,
    sourceSecurityGroupId: electricSqlSg.id,
    description: "Allow ElectricSQL to connect to Postgres",
  });

  const langfuseAccessCidrs = optionalStringList(
    "langfuseAccessCidrs",
    "TAXTRACK_LANGFUSE_ACCESS_CIDRS",
  ) ?? ["0.0.0.0/0"];

  const langfuseSg = new aws.ec2.SecurityGroup(
    `${ctx.namePrefix}-langfuse-sg`,
    {
      vpcId: vpc.id,
      description: "Langfuse EC2 security group",
      ingress: [
        {
          fromPort: 3000,
          toPort: 3000,
          protocol: "tcp",
          cidrBlocks: langfuseAccessCidrs,
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
    },
  );

  return {
    vpc,
    publicSubnet,
    publicSubnet2,
    privateSubnet,
    privateSubnet2,
    lambdaSg,
    workerSg,
    mergeBatchSg,
    rdsSg,
    electricSqlSg,
    langfuseSg,
  };
}
