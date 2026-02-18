import * as aws from "@pulumi/aws";
import { requiredSecret } from "./config";
import type { DataResources, InfraContext, NetworkResources } from "./types";

export function createData(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
  }
): DataResources {
  const dbPassword = requiredSecret("dbPassword", "TAXTRACK_DB_PASSWORD");
  const webhookSecretValue = requiredSecret("webhookSecret", "TAXTRACK_WEBHOOK_SECRET");

  const dbSubnetGroup = new aws.rds.SubnetGroup(`${ctx.namePrefix}-db-subnet-group`, {
    subnetIds: [input.network.privateSubnet.id],
    tags: {
      Name: `${ctx.namePrefix}-db-subnet-group`
    }
  });

  const db = new aws.rds.Instance(`${ctx.namePrefix}-postgres`, {
    allocatedStorage: 50,
    engine: "postgres",
    engineVersion: "16.3",
    instanceClass: ctx.stage === "prod" ? "db.t4g.medium" : "db.t4g.micro",
    dbName: "taxtrack",
    username: "taxtrack",
    password: dbPassword,
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [input.network.rdsSg.id],
    publiclyAccessible: false,
    multiAz: ctx.stage === "prod",
    backupRetentionPeriod: ctx.stage === "prod" ? 7 : 1,
    skipFinalSnapshot: ctx.stage !== "prod"
  });

  const artifactsBucket = new aws.s3.Bucket(`${ctx.namePrefix}-artifacts`, {
    tags: {
      Name: `${ctx.namePrefix}-artifacts`
    }
  });

  new aws.s3.BucketVersioningV2(`${ctx.namePrefix}-artifacts-versioning`, {
    bucket: artifactsBucket.id,
    versioningConfiguration: {
      status: "Enabled"
    }
  });

  const sourceFilesBucket = new aws.s3.Bucket(`${ctx.namePrefix}-source-files`, {
    tags: {
      Name: `${ctx.namePrefix}-source-files`
    }
  });

  new aws.s3.BucketVersioningV2(`${ctx.namePrefix}-source-files-versioning`, {
    bucket: sourceFilesBucket.id,
    versioningConfiguration: {
      status: "Enabled"
    }
  });

  const webhookSecret = new aws.secretsmanager.Secret(`${ctx.namePrefix}-webhook-secret`, {
    name: `${ctx.namePrefix}/webhook-secret`
  });

  const webhookSecretVersion = new aws.secretsmanager.SecretVersion(
    `${ctx.namePrefix}-webhook-secret-version`,
    {
      secretId: webhookSecret.id,
      secretString: webhookSecretValue
    }
  );

  return {
    db,
    dbSubnetGroup,
    artifactsBucket,
    sourceFilesBucket,
    webhookSecret,
    webhookSecretVersion
  };
}
