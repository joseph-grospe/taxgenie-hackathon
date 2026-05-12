import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type {
  DataResources,
  InfraContext,
  MergeBatchResources,
  NetworkResources,
} from "./types";

type Ec2ComputeResource = {
  instance: aws.ec2.Instance;
};

export function createPowerSchedule(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    data: DataResources;
    worker?: Ec2ComputeResource;
    electricSql?: Ec2ComputeResource;
    langfuse?: Ec2ComputeResource;
    mergeBatch?: MergeBatchResources;
  },
) {
  const ec2Instances = [
    input.network.natInstance,
    input.worker?.instance,
    input.electricSql?.instance,
    input.langfuse?.instance,
  ].filter((instance): instance is aws.ec2.Instance => Boolean(instance));

  const ec2InstanceIds = pulumi
    .all(ec2Instances.map((instance) => instance.id))
    .apply((ids) => ids.join(","));

  const controller = new sst.aws.Function(`${ctx.namePrefix}-power-schedule`, {
    runtime: "nodejs22.x",
    handler: "lambda/power-schedule.handler",
    timeout: "1 minute",
    environment: {
      EC2_INSTANCE_IDS: ec2InstanceIds,
      RDS_INSTANCE_ID: input.data.database.id,
      MERGE_BATCH_COMPUTE_ENVIRONMENT_ARN:
        input.mergeBatch?.computeEnvironment.arn ?? "",
      MERGE_BATCH_JOB_QUEUE_ARN: input.mergeBatch?.jobQueue.arn ?? "",
    },
    permissions: [
      {
        actions: [
          "batch:UpdateComputeEnvironment",
          "batch:UpdateJobQueue",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "rds:StartDBInstance",
          "rds:StopDBInstance",
        ],
        resources: ["*"],
      },
    ],
    dev: false,
  });

  const schedulerRole = new aws.iam.Role(
    `${ctx.namePrefix}-power-scheduler-role`,
    {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "scheduler.amazonaws.com",
      }),
    },
  );

  new aws.iam.RolePolicy(`${ctx.namePrefix}-power-scheduler-policy`, {
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

  const createSchedule = (
    name: string,
    scheduleExpression: string,
    action: "start-db" | "start-compute" | "stop",
  ) =>
    new aws.scheduler.Schedule(`${ctx.namePrefix}-power-${name}`, {
      scheduleExpression,
      scheduleExpressionTimezone: "Asia/Manila",
      flexibleTimeWindow: {
        mode: "OFF",
      },
      target: {
        arn: controller.arn,
        roleArn: schedulerRole.arn,
        input: JSON.stringify({ action }),
      },
    });

  createSchedule("start-db", "cron(45 7 ? * MON-FRI *)", "start-db");
  createSchedule(
    "start-compute",
    "cron(0 8 ? * MON-FRI *)",
    "start-compute",
  );
  createSchedule("stop", "cron(0 20 ? * MON-FRI *)", "stop");

  return {
    controller,
  };
}
