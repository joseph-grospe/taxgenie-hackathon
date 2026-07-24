import type * as aws from "@pulumi/aws";
import type { Output } from "@pulumi/pulumi";

export interface InfraContext {
  stage: string;
  namePrefix: string;
  region: string;
}

export interface NetworkResources {
  vpc: aws.ec2.Vpc;
  natInstance?: aws.ec2.Instance;
  publicSubnet: aws.ec2.Subnet;
  publicSubnet2: aws.ec2.Subnet;
  privateSubnet: aws.ec2.Subnet;
  privateSubnet2: aws.ec2.Subnet;
  lambdaSg: aws.ec2.SecurityGroup;
  workerSg: aws.ec2.SecurityGroup;
  mergeBatchSg: aws.ec2.SecurityGroup;
  rdsSg: aws.ec2.SecurityGroup;
  langfuseSg: aws.ec2.SecurityGroup;
}

export interface MergeBatchResources {
  computeEnvironment: aws.batch.ComputeEnvironment;
  jobQueue: aws.batch.JobQueue;
  jobDefinition: aws.batch.JobDefinition;
}

export interface QueueResources {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
}

export interface DataResources {
  database: sst.aws.Postgres;
  databaseUrl: Output<string>;
  db: {
    host: Output<string>;
    port: Output<number>;
    username: Output<string>;
    database: Output<string>;
  };
  storageBucket: aws.s3.Bucket;
  migrationInvocation?: aws.lambda.Invocation;
}
