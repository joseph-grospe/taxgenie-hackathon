import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { DriveFileEventV1 } from "@taxtrack/shared";

export async function enqueueDriveEvents(input: {
  client: SQSClient;
  queueUrl: string;
  events: DriveFileEventV1[];
}): Promise<void> {
  if (input.events.length === 0) {
    return;
  }

  const entries = input.events.map((event) => ({
    Id: event.eventId,
    MessageBody: JSON.stringify({ event })
  }));

  // SQS send batch supports up to 10 messages per request.
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10);

    const result = await input.client.send(
      new SendMessageBatchCommand({
        QueueUrl: input.queueUrl,
        Entries: batch
      })
    );

    if ((result.Failed?.length ?? 0) > 0) {
      throw new Error(`failed to enqueue ${result.Failed?.length ?? 0} messages to SQS`);
    }
  }
}
