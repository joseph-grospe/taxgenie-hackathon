import { ChangeMessageVisibilityCommand, SQSClient } from "@aws-sdk/client-sqs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startVisibilityHeartbeat(input: {
  client: SQSClient;
  queueUrl: string;
  receiptHandle: string;
  visibilityTimeoutSeconds: number;
}): () => Promise<void> {
  let running = true;

  const loop = async () => {
    const intervalMs = Math.max(30_000, Math.floor((input.visibilityTimeoutSeconds * 1000) / 2));

    while (running) {
      await sleep(intervalMs);
      if (!running) {
        break;
      }

      try {
        await input.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: input.queueUrl,
            ReceiptHandle: input.receiptHandle,
            VisibilityTimeout: input.visibilityTimeoutSeconds
          })
        );
      } catch {
        // Visibility extension failure will fall back to SQS retry behavior.
      }
    }
  };

  void loop();

  return async () => {
    running = false;
  };
}
