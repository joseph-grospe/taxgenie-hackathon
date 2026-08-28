import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { DataResources, InfraContext, NetworkResources } from "./types";

const retentionScheduleExpressionForStage = (stage: string) =>
  /^(dev|uat)(?:-|$)/.test(stage) ? "cron(0 15 * * ? *)" : "cron(30 1 * * ? *)";

export function createBatchRetentionSchedule(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    data: DataResources;
  },
) {
  const controller = new sst.aws.Function(`${ctx.namePrefix}-batch-retention`, {
    runtime: "nodejs22.x",
    handler: "lambda/batch-retention.handler",
    timeout: "10 minutes",
    memory: "512 MB",
    logging: {
      format: "json",
    },
    environment: {
      DATABASE_URL: input.data.databaseUrl,
      S3_BUCKET_NAME: input.data.storageBucket.bucket,
    },
    permissions: [
      {
        actions: ["s3:ListBucketVersions"],
        resources: [input.data.storageBucket.arn],
      },
      {
        actions: ["s3:DeleteObjectVersion"],
        resources: [pulumi.interpolate`${input.data.storageBucket.arn}/*`],
      },
    ],
    vpc: {
      privateSubnets: [
        input.network.privateSubnet.id,
        input.network.privateSubnet2.id,
      ],
      securityGroups: [input.network.lambdaSg.id],
    },
    dev: false,
  });
  const logGroupName = controller.nodes.logGroup.apply((logGroup) => {
    if (!logGroup) {
      throw new Error("Batch retention Lambda log group was not created.");
    }
    return logGroup.name;
  });
  const metricNamespace = `TaxGenie/${ctx.stage}/BatchRetention`;
  const metricFilters = [
    {
      name: "RetentionKeysDiscovered",
      value: "$.message.objectKeyCount",
      unit: "Count",
    },
    {
      name: "RetentionVersionTargetsDiscovered",
      value: "$.message.versionTargetCount",
      unit: "Count",
    },
    {
      name: "RetentionBytesDiscovered",
      value: "$.message.versionByteCount",
      unit: "Bytes",
    },
    {
      name: "RetentionFailures",
      value: "$.message.failureCount",
      unit: "Count",
    },
    {
      name: "RetentionRetryAgeSeconds",
      value: "$.message.retryAgeSeconds",
      unit: "Seconds",
    },
  ] as const;

  for (const metric of metricFilters) {
    new aws.cloudwatch.LogMetricFilter(
      `${ctx.namePrefix}-batch-retention-${metric.name}`,
      {
        logGroupName,
        pattern: '{ $.message.event = "batch_retention_attempt" }',
        metricTransformation: {
          name: metric.name,
          namespace: metricNamespace,
          unit: metric.unit,
          value: metric.value,
        },
      },
    );
  }

  const schedulerRole = new aws.iam.Role(
    `${ctx.namePrefix}-batch-retention-scheduler-role`,
    {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "scheduler.amazonaws.com",
      }),
    },
  );

  new aws.iam.RolePolicy(`${ctx.namePrefix}-batch-retention-scheduler-policy`, {
    role: schedulerRole.id,
    policy: controller.arn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "lambda:InvokeFunction",
            Resource: arn,
          },
        ],
      }),
    ),
  });

  const schedule = new aws.scheduler.Schedule(
    `${ctx.namePrefix}-batch-retention-daily`,
    {
      scheduleExpression: retentionScheduleExpressionForStage(ctx.stage),
      scheduleExpressionTimezone: "Asia/Manila",
      flexibleTimeWindow: {
        mode: "OFF",
      },
      target: {
        arn: controller.arn,
        roleArn: schedulerRole.arn,
        input: JSON.stringify({ limit: 25 }),
      },
    },
  );

  return {
    controller,
    schedule,
  };
}
