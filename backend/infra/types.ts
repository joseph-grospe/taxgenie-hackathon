import type * as aws from "@pulumi/aws";
import type { Output } from "@pulumi/pulumi";

export interface InfraContext {
  stage: string;
  namePrefix: string;
  region: string;
}

export interface NetworkResources {
  vpc: aws.ec2.Vpc;
  publicSubnet: aws.ec2.Subnet;
  privateSubnet: aws.ec2.Subnet;
  privateSubnet2: aws.ec2.Subnet;
  lambdaSg: aws.ec2.SecurityGroup;
  workerSg: aws.ec2.SecurityGroup;
  rdsSg: aws.ec2.SecurityGroup;
  electricSqlSg: aws.ec2.SecurityGroup;
  langfuseSg: aws.ec2.SecurityGroup;
}

export interface QueueResources {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
}

export interface DataResources {
  database: sst.aws.Aurora;
  databaseUrl: Output<string>;
  db: {
    host: Output<string>;
    port: Output<number>;
    username: Output<string>;
    database: Output<string>;
  };
  artifactsBucket: aws.s3.Bucket;
  sourceFilesBucket: aws.s3.Bucket;
  webhookSecret: aws.secretsmanager.Secret;
  webhookSecretVersion: aws.secretsmanager.SecretVersion;
  migrationInvocation?: aws.lambda.Invocation;
}
