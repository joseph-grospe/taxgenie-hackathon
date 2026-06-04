import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { DataResources, InfraContext, NetworkResources } from "./types";

const retentionScheduleExpressionForStage = (stage: string) =>
  /^(dev|uat)(?:-|$)/.test(stage)
    ? "cron(0 15 * * ? *)"
    : "cron(30 1 * * ? *)";

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
    environment: {
      DATABASE_URL: input.data.databaseUrl,
      S3_BUCKET_NAME: input.data.storageBucket.bucket,
    },
    permissions: [
      {
        actions: ["s3:DeleteObject"],
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
