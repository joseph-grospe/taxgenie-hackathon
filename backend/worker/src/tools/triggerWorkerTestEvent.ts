import { access } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { cwd } from "node:process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { config } from "dotenv";

interface CliOptions {
  file: string;
  bucket: string;
  queueUrl: string;
  sourceFileId?: string;
  revision: string;
  mimeType: string;
  prefix: string;
  region: string;
  profile?: string;
  eventId?: string;
  traceId?: string;
  dryRun: boolean;
}

type Args = {
  [key: string]: string | boolean | undefined;
};

function usage(): string {
  return `Usage:
  pnpm --filter @taxtrack/worker dev:emit-test-event \\
    --file <path> \\
    --bucket <s3-bucket> \\
    --queue-url <sqs-queue-url> \\
    [--source-file-id <id>] \\
    [--revision <revision>] \\
    [--mime-type <mimeType>] \\
    [--prefix <s3-prefix>] \\
    [--region <aws-region>] \\
    [--profile <aws-profile>] \\
    [--event-id <eventId>] \\
    [--trace-id <traceId>] \\
    [--dry-run]

Environment variables:
  AWS_REGION                AWS region
  AWS_PROFILE               AWS profile
  WORKER_TEST_S3_BUCKET     Optional default bucket
  WORKER_TEST_QUEUE_URL      Optional default queue URL

Examples:
  pnpm --filter @taxtrack/worker dev:emit-test-event --file ./sample.pdf --bucket artifacts-dev --queue-url https://sqs.../q`;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  const aliasMap: Record<string, string> = {
    file: "file",
    bucket: "bucket",
    "queue-url": "queueUrl",
    "source-file-id": "sourceFileId",
    revision: "revision",
    "mime-type": "mimeType",
    prefix: "prefix",
    region: "region",
    profile: "profile",
    "event-id": "eventId",
    "trace-id": "traceId",
    "dry-run": "dryRun",
    help: "help"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const normalized = aliasMap[key] ?? key;

      if (normalized === "dryRun" || normalized === "help") {
        parsed[normalized] = true;
        continue;
      }

      const value = argv[i + 1];
      if (!value) {
        throw new Error(`Missing value for --${key}`);
      }

      if (value.startsWith("--")) {
        throw new Error(`Unknown argument ${value}`);
      }

      if (value.length === 0) {
        parsed[normalized] = undefined;
      } else {
        parsed[normalized] = value;
      }

      i += 1;
      continue;
    }
    throw new Error(`Unknown argument ${arg}`);
  }

  return parsed;
}

function buildCliOptions(parsed: Args): CliOptions {
  if (parsed.help) {
    throw new Error(usage());
  }

  const file = typeof parsed.file === "string" ? parsed.file : "";
  const bucket =
    typeof parsed.bucket === "string"
      ? parsed.bucket
      : process.env.WORKER_TEST_S3_BUCKET ?? process.env.S3_BUCKET ?? "";
  const queueUrl =
    typeof parsed.queueUrl === "string"
      ? parsed.queueUrl
      : process.env.WORKER_TEST_QUEUE_URL ?? process.env.SQS_QUEUE_URL ?? "";

  if (!file || !bucket || !queueUrl) {
    throw new Error(
      "Missing required values. Use --file, --bucket, and --queue-url, or set WORKER_TEST_S3_BUCKET and WORKER_TEST_QUEUE_URL."
    );
  }

  const sourceFileId =
    typeof parsed.sourceFileId === "string"
      ? parsed.sourceFileId
      : `worker-test-${Date.now()}`;

  return {
    file,
    bucket,
    queueUrl,
    sourceFileId,
    revision: String(parsed.revision ?? "1"),
    mimeType: String(
      parsed.mimeType ??
        "application/pdf"
    ),
    prefix: String(parsed.prefix ?? "worker-test-events"),
    region: String(parsed.region ?? process.env.AWS_REGION ?? "ap-southeast-1"),
    profile: parsed.profile as string | undefined,
    eventId:
      typeof parsed.eventId === "string"
        ? parsed.eventId
        : `${sourceFileId}:${String(parsed.revision ?? "1")}`,
    traceId: parsed.traceId as string | undefined,
    dryRun: Boolean(parsed.dryRun),
  };
}

function toIsoNow(): string {
  return new Date().toISOString();
}

async function main() {
  try {
    config({ path: resolve(cwd(), "../../.env") });
    const parsed = parseArgs(process.argv.slice(2));
    const options = buildCliOptions(parsed);

    const absoluteFilePath = resolve(cwd(), options.file);
    const fileName = basename(absoluteFilePath);
    const now = toIsoNow();
    const revision = options.revision;
    if (options.profile) {
      process.env.AWS_PROFILE = options.profile;
    }
    await access(absoluteFilePath);

    if (!options.dryRun) {
      const objectKey =
        `${options.prefix.replace(/\/+$/u, "")}/` +
        `${options.sourceFileId}/${revision}/${fileName}`;

      const s3 = new S3Client({ region: options.region });
      await s3.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: objectKey,
          Body: createReadStream(absoluteFilePath),
          ContentType: options.mimeType
        })
      );

      const sqs = new SQSClient({ region: options.region });

      const event = {
        version: "v1" as const,
        eventId: options.eventId!,
        traceId: options.traceId ?? randomUUID(),
        source: "google-drive" as const,
        sourceFileId: options.sourceFileId!,
        revision,
        modifiedTime: now,
        mimeType: options.mimeType,
        artifactUri: `s3://${options.bucket}/${objectKey}`,
        receivedAt: now
      };

      const payload = JSON.stringify({ event });
      const response = await sqs.send(
        new SendMessageCommand({
          QueueUrl: options.queueUrl,
          MessageBody: payload
        })
      );

      console.log("S3 upload complete", {
        bucket: options.bucket,
        key: objectKey,
        messageId: response.MessageId
      });
      console.log("Queue message sent", {
        eventId: options.eventId,
        queueUrl: options.queueUrl
      });
    } else {
      const objectKey =
        `${options.prefix.replace(/\/+$/u, "")}/` +
        `${options.sourceFileId}/${options.revision}/${fileName}`;
      const payload = {
        event: {
          version: "v1",
          eventId: options.eventId!,
          traceId: options.traceId ?? randomUUID(),
          source: "google-drive",
          sourceFileId: options.sourceFileId,
          revision: options.revision,
          modifiedTime: now,
          mimeType: options.mimeType,
          artifactUri: `s3://${options.bucket}/${objectKey}`,
          receivedAt: now
        }
      };

      console.log("Dry run payload:");
      console.log(JSON.stringify(payload, null, 2));
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Usage:")) {
      console.log(error.message);
      process.exit(1);
    }
    if (error instanceof Error && error.message.includes("Unknown argument")) {
      console.error(error.message);
      console.log(usage());
      process.exit(1);
    }

    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
