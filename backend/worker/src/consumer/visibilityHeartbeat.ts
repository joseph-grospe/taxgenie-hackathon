import { ChangeMessageVisibilityCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "@taxtrack/shared";

export interface VisibilityHeartbeatInput {
  client: SQSClient;
  queueUrl: string;
  receiptHandle: string;
  visibilityTimeoutSeconds: number;
  logger: Logger;
  messageId?: string;
  approximateReceiveCount?: number;
  heartbeatIntervalMs?: number;
  retryDelayMs?: number;
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function startVisibilityHeartbeat(
  input: VisibilityHeartbeatInput,
): () => Promise<void> {
  const heartbeatIntervalMs =
    input.heartbeatIntervalMs ??
    Math.max(1_000, Math.floor((input.visibilityTimeoutSeconds * 1_000) / 3));
  const retryDelayMs = input.retryDelayMs ?? 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let consecutiveFailures = 0;

  const schedule = (delayMs: number) => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      inFlight = tick().finally(() => {
        inFlight = undefined;
      });
    }, delayMs);
  };

  const tick = async () => {
    try {
      await input.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: input.queueUrl,
          ReceiptHandle: input.receiptHandle,
          VisibilityTimeout: input.visibilityTimeoutSeconds,
        }),
      );
      consecutiveFailures = 0;
      schedule(heartbeatIntervalMs);
    } catch (error) {
      consecutiveFailures += 1;
      input.logger.warn("SQS visibility heartbeat failed", {
        event: "sqs_visibility_heartbeat_failed",
        metricName: "SqsVisibilityHeartbeatFailures",
        metricValue: 1,
        messageId: input.messageId,
        approximateReceiveCount: input.approximateReceiveCount,
        consecutiveFailures,
        visibilityTimeoutSeconds: input.visibilityTimeoutSeconds,
        error: error instanceof Error ? error.message : String(error),
        errorClass: errorClass(error),
      });
      schedule(retryDelayMs);
    }
  };

  schedule(heartbeatIntervalMs);

  return async () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    await inFlight;
  };
}
