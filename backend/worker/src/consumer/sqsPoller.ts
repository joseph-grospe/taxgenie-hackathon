import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";
import type { Logger } from "@taxgenie/shared";
import { startVisibilityHeartbeat } from "./visibilityHeartbeat";

export interface SanitizedMessageValidationIssue {
  code: string;
  path: string;
}

export type MessageDisposition =
  | { kind: "acknowledge" }
  | { kind: "retry"; reason: "claim_busy" }
  | {
      kind: "poison";
      reason: "invalid_json" | "invalid_event_schema";
      validationIssues?: SanitizedMessageValidationIssue[];
    };

type PollerSleep = (ms: number, signal: AbortSignal) => Promise<void>;

function createAbortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function calculateReceiveBackoffMs(
  failureCount: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, failureCount - 1);
  const ceilingMs = Math.min(30_000, 1_000 * 2 ** exponent);
  const jitter = Math.min(1, Math.max(0, random()));
  return Math.floor(ceilingMs * jitter);
}

interface PollerInput {
  client: SQSClient;
  queueUrl: string;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  concurrency: number;
  logger: Logger;
  processMessage: (body: string) => Promise<MessageDisposition>;
  sleep?: PollerSleep;
  random?: () => number;
  startHeartbeat?: typeof startVisibilityHeartbeat;
}

export class SqsPoller {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeoutSeconds: number;
  private readonly concurrency: number;
  private readonly logger: Logger;
  private readonly processMessage: (
    body: string,
  ) => Promise<MessageDisposition>;
  private readonly sleep: PollerSleep;
  private readonly random: () => number;
  private readonly startHeartbeat: typeof startVisibilityHeartbeat;
  private readonly inflight = new Set<Promise<void>>();
  private readonly resumeWaiters = new Set<() => void>();
  private activeOperationAbortController: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;
  private running = false;
  private paused = false;
  private drained = false;

  constructor(input: PollerInput) {
    this.client = input.client;
    this.queueUrl = input.queueUrl;
    this.waitTimeSeconds = input.waitTimeSeconds;
    this.visibilityTimeoutSeconds = input.visibilityTimeoutSeconds;
    this.concurrency = input.concurrency;
    this.logger = input.logger;
    this.processMessage = input.processMessage;
    this.sleep = input.sleep ?? abortableSleep;
    this.random = input.random ?? Math.random;
    this.startHeartbeat = input.startHeartbeat ?? startVisibilityHeartbeat;
  }

  start(): void {
    if (this.running || this.drained) {
      return;
    }

    this.running = true;
    const loopPromise = this.loop().catch((error) => {
      this.running = false;
      this.logger.error("SQS poller stopped unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
        errorClass: errorClass(error),
      });
    });
    this.loopPromise = loopPromise;
    void loopPromise.finally(() => {
      if (this.loopPromise === loopPromise) {
        this.loopPromise = undefined;
      }
    });
  }

  pause(): void {
    if (!this.running || this.paused) {
      return;
    }

    this.paused = true;
    this.abortActiveOperation();
  }

  resume(): void {
    if (!this.running || !this.paused) {
      return;
    }

    this.paused = false;
    this.wakeResumeWaiters();
  }

  async drain(): Promise<void> {
    this.drained = true;
    this.running = false;
    this.paused = false;
    this.abortActiveOperation();
    this.wakeResumeWaiters();

    await this.loopPromise;

    while (this.inflight.size > 0) {
      await Promise.race(this.inflight);
    }
  }

  private abortActiveOperation(): void {
    this.activeOperationAbortController?.abort();
  }

  private wakeResumeWaiters(): void {
    for (const resolve of this.resumeWaiters) {
      resolve();
    }
    this.resumeWaiters.clear();
  }

  private async waitUntilResumed(): Promise<void> {
    if (!this.running || !this.paused) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.resumeWaiters.add(resolve);
    });
  }

  private async waitForBackoff(ms: number): Promise<void> {
    if (ms <= 0 || !this.running || this.paused) {
      return;
    }

    const controller = new AbortController();
    this.activeOperationAbortController = controller;
    try {
      await this.sleep(ms, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.activeOperationAbortController === controller) {
        this.activeOperationAbortController = undefined;
      }
    }
  }

  private async loop(): Promise<void> {
    let receiveFailureCount = 0;

    while (this.running) {
      if (this.paused) {
        await this.waitUntilResumed();
        continue;
      }

      const freeSlots = this.concurrency - this.inflight.size;
      if (freeSlots <= 0) {
        await Promise.race(this.inflight);
        continue;
      }

      const receiveController = new AbortController();
      this.activeOperationAbortController = receiveController;

      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            WaitTimeSeconds: this.waitTimeSeconds,
            VisibilityTimeout: this.visibilityTimeoutSeconds,
            MaxNumberOfMessages: Math.min(freeSlots, 10),
            MessageSystemAttributeNames: ["ApproximateReceiveCount"],
          }),
          { abortSignal: receiveController.signal },
        );
        receiveFailureCount = 0;

        const messages = response.Messages ?? [];
        if (!this.running || this.paused) {
          await this.releaseUnadmittedMessages(messages);
          continue;
        }

        for (let index = 0; index < messages.length; index += 1) {
          if (!this.running || this.paused) {
            await this.releaseUnadmittedMessages(messages.slice(index));
            break;
          }

          const message = messages[index];
          const task = this.processSingleMessage(message).finally(() => {
            this.inflight.delete(task);
          });
          this.inflight.add(task);
        }
      } catch (error) {
        const admissionClosed = !this.running || this.paused;
        if (receiveController.signal.aborted && admissionClosed) {
          continue;
        }

        receiveFailureCount += 1;
        const backoffMs = calculateReceiveBackoffMs(
          receiveFailureCount,
          this.random,
        );
        this.logger.error("SQS receive loop failed", {
          error: error instanceof Error ? error.message : String(error),
          errorClass: errorClass(error),
          failureCount: receiveFailureCount,
          backoffMs,
        });
        await this.waitForBackoff(backoffMs);
      } finally {
        if (this.activeOperationAbortController === receiveController) {
          this.activeOperationAbortController = undefined;
        }
      }
    }
  }

  private async releaseUnadmittedMessages(messages: Message[]): Promise<void> {
    const entries = messages.flatMap((message, index) => {
      if (!message.ReceiptHandle) {
        this.logger.warn("Unable to release unadmitted SQS message", {
          messageId: message.MessageId,
          reason: "missing_receipt_handle",
        });
        return [];
      }

      return [
        {
          Id: `message-${index}`,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: 0,
        },
      ];
    });

    if (entries.length === 0) {
      return;
    }

    try {
      const response = await this.client.send(
        new ChangeMessageVisibilityBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: entries,
        }),
      );

      if ((response.Failed?.length ?? 0) > 0) {
        this.logger.warn("Some unadmitted SQS messages could not be released", {
          failedEntries: response.Failed?.map((failure) => ({
            id: failure.Id,
            code: failure.Code,
            senderFault: failure.SenderFault,
          })),
        });
      }
    } catch (error) {
      this.logger.warn("Failed to release unadmitted SQS messages", {
        messageCount: entries.length,
        error: error instanceof Error ? error.message : String(error),
        errorClass: errorClass(error),
      });
    }
  }

  private async processSingleMessage(message: Message): Promise<void> {
    await processSqsMessage({
      client: this.client,
      queueUrl: this.queueUrl,
      visibilityTimeoutSeconds: this.visibilityTimeoutSeconds,
      logger: this.logger,
      processMessage: this.processMessage,
      message,
      startHeartbeat: this.startHeartbeat,
    });
  }
}

interface ProcessSqsMessageInput {
  client: SQSClient;
  queueUrl: string;
  visibilityTimeoutSeconds: number;
  logger: Logger;
  processMessage: (body: string) => Promise<MessageDisposition>;
  message: Message;
  startHeartbeat?: typeof startVisibilityHeartbeat;
}

function approximateReceiveCount(message: Message): number | undefined {
  const rawCount = message.Attributes?.ApproximateReceiveCount;
  if (!rawCount) {
    return undefined;
  }

  const parsed = Number.parseInt(rawCount, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function processSqsMessage(
  input: ProcessSqsMessageInput,
): Promise<void> {
  const { message } = input;
  const receiveCount = approximateReceiveCount(message);

  if (!message.Body || !message.ReceiptHandle) {
    input.logger.warn("Poison SQS message is missing required envelope data", {
      event: "sqs_poison_message",
      messageId: message.MessageId,
      approximateReceiveCount: receiveCount,
      reason: !message.Body ? "missing_body" : "missing_receipt_handle",
    });
    return;
  }

  const stopHeartbeat = (input.startHeartbeat ?? startVisibilityHeartbeat)({
    client: input.client,
    queueUrl: input.queueUrl,
    receiptHandle: message.ReceiptHandle,
    visibilityTimeoutSeconds: input.visibilityTimeoutSeconds,
    logger: input.logger,
    messageId: message.MessageId,
    approximateReceiveCount: receiveCount,
  });

  try {
    const disposition = await input.processMessage(message.Body);
    if (disposition.kind === "retry") {
      input.logger.info("Deferred SQS message because worker claim is held", {
        messageId: message.MessageId,
        approximateReceiveCount: receiveCount,
        reason: disposition.reason,
      });
      return;
    }

    if (disposition.kind === "poison") {
      input.logger.warn("Poison SQS message will follow queue redrive policy", {
        event: "sqs_poison_message",
        messageId: message.MessageId,
        approximateReceiveCount: receiveCount,
        reason: disposition.reason,
        validationIssues: disposition.validationIssues,
      });
      return;
    }

    await input.client.send(
      new DeleteMessageCommand({
        QueueUrl: input.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );

    input.logger.info("Processed SQS message", {
      messageId: message.MessageId,
      approximateReceiveCount: receiveCount,
    });
  } catch (error) {
    input.logger.error("Failed processing SQS message", {
      messageId: message.MessageId,
      approximateReceiveCount: receiveCount,
      error: error instanceof Error ? error.message : String(error),
      errorClass: errorClass(error),
    });
  } finally {
    await stopHeartbeat();
  }
}
