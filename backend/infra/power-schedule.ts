import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type {
  DataResources,
  InfraContext,
  MergeBatchResources,
  NetworkResources,
} from "./types";

type WorkerComputeResource = {
  instances: aws.ec2.Instance[];
};

export function collectScheduledEc2Instances<T>(input: {
  natInstance?: T;
  workerInstances?: readonly T[];
}): T[] {
  return [
    input.natInstance,
    ...(input.workerInstances ?? []),
  ].filter((instance): instance is T => instance !== undefined);
}

function powerScheduleExpressionsForStage(stage: string) {
  if (stage === "uat") {
    return {
      startDb: "cron(45 7 * * ? *)",
      startCompute: "cron(0 8 * * ? *)",
      stop: "cron(0 22 * * ? *)",
    };
  }

  return {
    startDb: "cron(45 7 ? * MON-FRI *)",
    startCompute: "cron(0 8 ? * MON-FRI *)",
    stop: "cron(0 20 ? * MON-FRI *)",
  };
}

export function createPowerSchedule(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    data: DataResources;
    worker?: WorkerComputeResource;
    mergeBatch?: MergeBatchResources;
  },
) {
  const ec2Instances = collectScheduledEc2Instances({
    natInstance: input.network.natInstance,
    workerInstances: input.worker?.instances,
  });

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

  const scheduleExpressions = powerScheduleExpressionsForStage(ctx.stage);

  createSchedule("start-db", scheduleExpressions.startDb, "start-db");
  createSchedule(
    "start-compute",
    scheduleExpressions.startCompute,
    "start-compute",
  );
  createSchedule("stop", scheduleExpressions.stop, "stop");

  return {
    controller,
  };
}
