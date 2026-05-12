import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  BatchClient,
  UpdateComputeEnvironmentCommand,
  UpdateJobQueueCommand,
} from "@aws-sdk/client-batch";
import {
  RDSClient,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
} from "@aws-sdk/client-rds";

type PowerScheduleAction = "start-db" | "start-compute" | "stop";

const region = process.env.AWS_REGION ?? "ap-southeast-1";
const ec2 = new EC2Client({ region });
const batch = new BatchClient({ region });
const rds = new RDSClient({ region });

function listEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAlreadyInTargetState(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "IncorrectInstanceState",
    "IncorrectInstanceStateException",
    "InvalidDBInstanceState",
    "InvalidDBInstanceStateFault",
  ].includes(error.name);
}

async function ignoreAlreadyInTargetState(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    if (isAlreadyInTargetState(error)) {
      console.log("Resource is already in a compatible state.", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return;
    }

    throw error;
  }
}

async function updateBatchResources(state: "ENABLED" | "DISABLED") {
  const computeEnvironment = process.env.MERGE_BATCH_COMPUTE_ENVIRONMENT_ARN;
  const jobQueue = process.env.MERGE_BATCH_JOB_QUEUE_ARN;

  if (jobQueue) {
    await batch.send(
      new UpdateJobQueueCommand({
        jobQueue,
        state,
      }),
    );
  }

  if (computeEnvironment) {
    await batch.send(
      new UpdateComputeEnvironmentCommand({
        computeEnvironment,
        state,
      }),
    );
  }
}

export const handler = async (event: { action?: PowerScheduleAction }) => {
  const action = event.action;
  const ec2InstanceIds = listEnv("EC2_INSTANCE_IDS");
  const rdsInstanceId = process.env.RDS_INSTANCE_ID;

  if (!action) {
    throw new Error("Missing power schedule action.");
  }

  if (action === "start-db") {
    if (!rdsInstanceId) {
      throw new Error("Missing RDS_INSTANCE_ID.");
    }

    await ignoreAlreadyInTargetState(
      rds.send(
        new StartDBInstanceCommand({
          DBInstanceIdentifier: rdsInstanceId,
        }),
      ),
    );

    return { action, rdsInstanceId };
  }

  if (action === "start-compute") {
    if (ec2InstanceIds.length > 0) {
      await ignoreAlreadyInTargetState(
        ec2.send(
          new StartInstancesCommand({
            InstanceIds: ec2InstanceIds,
          }),
        ),
      );
    }

    await updateBatchResources("ENABLED");

    return { action, ec2InstanceIds };
  }

  if (action === "stop") {
    await updateBatchResources("DISABLED");

    if (ec2InstanceIds.length > 0) {
      await ignoreAlreadyInTargetState(
        ec2.send(
          new StopInstancesCommand({
            InstanceIds: ec2InstanceIds,
          }),
        ),
      );
    }

    if (rdsInstanceId) {
      await ignoreAlreadyInTargetState(
        rds.send(
          new StopDBInstanceCommand({
            DBInstanceIdentifier: rdsInstanceId,
          }),
        ),
      );
    }

    return { action, ec2InstanceIds, rdsInstanceId };
  }

  throw new Error(`Unsupported power schedule action: ${action}`);
};
