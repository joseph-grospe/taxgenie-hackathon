import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { requiredString } from "./config";
import type { InfraSizing } from "./sizing";
import type {
  DataResources,
  InfraContext,
  MergeBatchResources,
  NetworkResources,
} from "./types";

export function createMergeBatchCompute(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    data: DataResources;
    sizing: InfraSizing;
  },
): MergeBatchResources {
  const mergeWorkerImageUri = requiredString(
    "mergeWorkerImageUri",
    "TAXTRACK_MERGE_WORKER_IMAGE_URI",
  );
  if (
    mergeWorkerImageUri === "replace-me" ||
    !mergeWorkerImageUri.includes("/")
  ) {
    throw new Error(
      "TAXTRACK_MERGE_WORKER_IMAGE_URI must be a fully qualified image URI before deploying merge Batch compute.",
    );
  }

  const batchServiceRole = new aws.iam.Role(
    `${ctx.namePrefix}-merge-batch-service-role`,
    {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "batch.amazonaws.com",
      }),
    },
  );

  const batchServicePolicy = new aws.iam.RolePolicyAttachment(
    `${ctx.namePrefix}-merge-batch-service-policy`,
    {
      role: batchServiceRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole",
    },
  );

  const executionRole = new aws.iam.Role(
    `${ctx.namePrefix}-merge-execution-role`,
    {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "ecs-tasks.amazonaws.com",
      }),
    },
  );

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-merge-execution-policy`, {
    role: executionRole.name,
    policyArn:
      "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  });

  const jobRole = new aws.iam.Role(`${ctx.namePrefix}-merge-job-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ecs-tasks.amazonaws.com",
    }),
  });

  new aws.iam.RolePolicy(`${ctx.namePrefix}-merge-job-policy`, {
    role: jobRole.id,
    policy: input.data.storageBucket.arn.apply((storageBucketArn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["s3:ListBucket", "s3:GetBucketLocation"],
            Resource: storageBucketArn,
          },
          {
            Effect: "Allow",
            Action: ["s3:GetObject", "s3:PutObject"],
            Resource: `${storageBucketArn}/*`,
          },
        ],
      }),
    ),
  });

  const logGroup = new aws.cloudwatch.LogGroup(
    `${ctx.namePrefix}-merge-batch-logs`,
    {
      name: `/aws/batch/${ctx.namePrefix}-merge-worker`,
      retentionInDays: 30,
    },
  );

  const computeEnvironment = new aws.batch.ComputeEnvironment(
    `${ctx.namePrefix}-merge-fargate-ce`,
    {
      type: "MANAGED",
      serviceRole: batchServiceRole.arn,
      computeResources: {
        type: "FARGATE",
        maxVcpus: input.sizing.mergeBatch.maxVcpus,
        subnets: [
          input.network.privateSubnet.id,
          input.network.privateSubnet2.id,
        ],
        securityGroupIds: [input.network.mergeBatchSg.id],
      },
    },
    {
      dependsOn: [batchServicePolicy],
    },
  );

  const jobQueue = new aws.batch.JobQueue(`${ctx.namePrefix}-merge-job-queue`, {
    priority: 10,
    state: "ENABLED",
    computeEnvironmentOrders: [
      {
        order: 1,
        computeEnvironment: computeEnvironment.arn,
      },
    ],
  });

  const containerProperties = pulumi
    .all([
      input.data.databaseUrl,
      input.data.storageBucket.bucket,
      executionRole.arn,
      jobRole.arn,
      logGroup.name,
    ])
    .apply(
      ([databaseUrl, bucketName, executionRoleArn, jobRoleArn, logGroupName]) =>
        JSON.stringify({
          image: mergeWorkerImageUri,
          executionRoleArn,
          jobRoleArn,
          resourceRequirements: [
            {
              type: "VCPU",
              value: input.sizing.mergeBatch.jobVcpus,
            },
            {
              type: "MEMORY",
              value: String(input.sizing.mergeBatch.jobMemoryMib),
            },
          ],
          fargatePlatformConfiguration: {
            platformVersion: "LATEST",
          },
          ephemeralStorage: {
            sizeInGiB: input.sizing.mergeBatch.jobEphemeralGib,
          },
          environment: [
            {
              name: "AWS_REGION",
              value: ctx.region,
            },
            {
              name: "DATABASE_URL",
              value: databaseUrl,
            },
            {
              name: "S3_BUCKET_NAME",
              value: bucketName,
            },
            {
              name: "S3_OBJECT_PREFIX",
              value: "v2",
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": ctx.region,
              "awslogs-stream-prefix": "merge",
            },
          },
        }),
    );

  const jobDefinition = new aws.batch.JobDefinition(
    `${ctx.namePrefix}-merge-job-definition`,
    {
      type: "container",
      platformCapabilities: ["FARGATE"],
      containerProperties,
      retryStrategy: {
        attempts: 1,
      },
      timeout: {
        attemptDurationSeconds: 6 * 60 * 60,
      },
    },
  );

  return {
    computeEnvironment,
    jobQueue,
    jobDefinition,
  };
}
