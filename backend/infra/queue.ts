import * as aws from "@pulumi/aws";
import type { InfraContext, QueueResources } from "./types";

export function createQueue(ctx: InfraContext): QueueResources {
  const dlq = new aws.sqs.Queue(`${ctx.namePrefix}-events-dlq`, {
    name: `taxgenie-events-dlq-${ctx.stage}`,
    messageRetentionSeconds: 1209600
  });

  const queue = new aws.sqs.Queue(`${ctx.namePrefix}-events`, {
    name: `taxgenie-events-${ctx.stage}`,
    receiveWaitTimeSeconds: 20,
    visibilityTimeoutSeconds: 300,
    redrivePolicy: dlq.arn.apply((arn) =>
      JSON.stringify({
        deadLetterTargetArn: arn,
        maxReceiveCount: 5
      })
    )
  });

  return { queue, dlq };
}
