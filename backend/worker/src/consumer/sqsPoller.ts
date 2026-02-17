import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message
} from "@aws-sdk/client-sqs";
import type { Logger } from "@taxtrack/shared";
import { startVisibilityHeartbeat } from "./visibilityHeartbeat";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PollerInput {
  client: SQSClient;
  queueUrl: string;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  concurrency: number;
  logger: Logger;
  processMessage: (body: string) => Promise<void>;
}

export class SqsPoller {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeoutSeconds: number;
  private readonly concurrency: number;
  private readonly logger: Logger;
  private readonly processMessage: (body: string) => Promise<void>;
  private readonly inflight = new Set<Promise<void>>();
  private running = false;
  private paused = false;

  constructor(input: PollerInput) {
    this.client = input.client;
    this.queueUrl = input.queueUrl;
    this.waitTimeSeconds = input.waitTimeSeconds;
    this.visibilityTimeoutSeconds = input.visibilityTimeoutSeconds;
    this.concurrency = input.concurrency;
    this.logger = input.logger;
    this.processMessage = input.processMessage;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.loop();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async drain(): Promise<void> {
    this.running = false;

    while (this.inflight.size > 0) {
      await Promise.race(this.inflight);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (this.paused) {
        await sleep(500);
        continue;
      }

      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            WaitTimeSeconds: this.waitTimeSeconds,
            VisibilityTimeout: this.visibilityTimeoutSeconds,
            MaxNumberOfMessages: 5
          })
        );

        const messages = response.Messages ?? [];
        for (const message of messages) {
          while (this.inflight.size >= this.concurrency) {
            await Promise.race(this.inflight);
          }

          const task = this.processSingleMessage(message).finally(() => {
            this.inflight.delete(task);
          });

          this.inflight.add(task);
        }
      } catch (error) {
        this.logger.error("SQS receive loop failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        await sleep(2_000);
      }
    }
  }

  private async processSingleMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) {
      this.logger.warn("Skipping malformed SQS message", {
        messageId: message.MessageId
      });
      return;
    }

    const stopHeartbeat = startVisibilityHeartbeat({
      client: this.client,
      queueUrl: this.queueUrl,
      receiptHandle: message.ReceiptHandle,
      visibilityTimeoutSeconds: this.visibilityTimeoutSeconds
    });

    try {
      await this.processMessage(message.Body);

      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle
        })
      );

      this.logger.info("Processed SQS message", {
        messageId: message.MessageId
      });
    } catch (error) {
      this.logger.error("Failed processing SQS message", {
        messageId: message.MessageId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await stopHeartbeat();
    }
  }
}
