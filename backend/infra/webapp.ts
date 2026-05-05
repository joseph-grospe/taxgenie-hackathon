/// <reference path="./.sst/platform/config.d.ts" />

import * as pulumi from "@pulumi/pulumi";
import { optionalString, requiredSecret } from "./config";
import type {
  MergeBatchResources,
  NetworkResources,
  QueueResources,
} from "./types";

type SourceBucketRef = {
  name?: string | pulumi.Input<string>;
  arn?: string | pulumi.Input<string>;
};

type CreateWebTrackFrontendInput = {
  s3Bucket?: SourceBucketRef;
  resultsBucket?: SourceBucketRef;
  queue?: QueueResources;
  mergeBatch?: MergeBatchResources;
  region?: string;
  s3Prefix?: string;
  s3MaxKeys?: string | number;
  databaseUrl?: string | pulumi.Input<string>;
  electricSqlUrl?: string | pulumi.Input<string>;
  network?: NetworkResources;
  stage?: string;
};

const firstValue = (
  ...values: Array<string | pulumi.Input<string> | undefined>
): string | pulumi.Input<string> | undefined => {
  return values.find((value) => value !== undefined) as
    | string
    | pulumi.Input<string>
    | undefined;
};

export function createWebTrackFrontend(
  input: CreateWebTrackFrontendInput = {},
) {
  const bucketName = firstValue(
    input.s3Bucket?.name,
    process.env.S3_BUCKET_NAME,
  );
  const bucketArn = input.s3Bucket?.arn;
  const resultsBucketName = firstValue(
    input.resultsBucket?.name,
    process.env.S3_RESULTS_BUCKET_NAME,
  );
  const resultsBucketArn = input.resultsBucket?.arn;
  const effectiveBucketArn =
    bucketArn ??
    (bucketName ? pulumi.interpolate`arn:aws:s3:::${bucketName}` : undefined);
  const effectiveResultsBucketArn =
    resultsBucketArn ??
    (resultsBucketName
      ? pulumi.interpolate`arn:aws:s3:::${resultsBucketName}`
      : undefined);
  const s3Region = firstValue(input.region, process.env.S3_REGION);
  const environment: Record<string, string | pulumi.Input<string>> = {
    S3_REGION: s3Region || "ap-southeast-1",
  };
  if (input.stage) {
    environment.TAXTRACK_APP_STAGE = input.stage;
  }
  const permissions = effectiveBucketArn
    ? [
        {
          actions: ["s3:ListBucket"],
          resources: [effectiveBucketArn],
        },
        {
          actions: ["s3:GetObject", "s3:PutObject"],
          resources: [pulumi.interpolate`${effectiveBucketArn}/*`],
        },
      ]
    : [];

  if (input.queue) {
    environment.SQS_QUEUE_URL = input.queue.queue.url;
    permissions.push({
      actions: ["sqs:SendMessage"],
      resources: [input.queue.queue.arn],
    });
  }

  if (input.mergeBatch) {
    environment.MERGE_BATCH_JOB_QUEUE = input.mergeBatch.jobQueue.arn;
    environment.MERGE_BATCH_JOB_DEFINITION = input.mergeBatch.jobDefinition.arn;
    permissions.push(
      {
        actions: ["batch:SubmitJob"],
        resources: [
          input.mergeBatch.jobQueue.arn,
          input.mergeBatch.jobDefinition.arn,
        ],
      },
      {
        actions: ["batch:DescribeJobs"],
        resources: ["*"],
      },
    );
  }

  if (bucketName) {
    environment.S3_BUCKET_NAME = bucketName;
    environment.S3_SOURCE_BUCKET_NAME = bucketName;
  }

  if (resultsBucketName) {
    environment.S3_RESULTS_BUCKET_NAME = resultsBucketName;
  }

  if (
    effectiveResultsBucketArn &&
    effectiveResultsBucketArn !== effectiveBucketArn
  ) {
    permissions.push(
      {
        actions: ["s3:ListBucket"],
        resources: [effectiveResultsBucketArn],
      },
      {
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [pulumi.interpolate`${effectiveResultsBucketArn}/*`],
      },
    );
  }

  const prefix = firstValue(input.s3Prefix, process.env.S3_PREFIX);
  if (prefix) {
    environment.S3_PREFIX = prefix;
  }

  const maxKeys = firstValue(
    input.s3MaxKeys?.toString(),
    process.env.S3_MAX_KEYS,
  );
  if (maxKeys) {
    environment.S3_MAX_KEYS = maxKeys;
  }

  const betterAuthSecret = requiredSecret(
    "betterAuthSecret",
    "BETTER_AUTH_SECRET",
  );
  const betterAuthUrl =
    optionalString("betterAuthUrl", "BETTER_AUTH_URL") ??
    process.env.BETTER_AUTH_URL;
  environment.BETTER_AUTH_SECRET = betterAuthSecret;
  if (betterAuthUrl) {
    environment.BETTER_AUTH_URL = betterAuthUrl;
  }

  const databaseUrl =
    firstValue(input.databaseUrl) ??
    optionalString("databaseUrl", "DATABASE_URL") ??
    process.env.DATABASE_URL;
  if (databaseUrl) {
    environment.DATABASE_URL = databaseUrl;
  }

  const electricSqlUrl =
    firstValue(input.electricSqlUrl) ??
    optionalString("electricSqlUrl", "ELECTRICSQL_URL") ??
    process.env.ELECTRICSQL_URL;
  if (electricSqlUrl) {
    environment.ELECTRICSQL_URL = electricSqlUrl;
    environment.VITE_ELECTRICSQL_URL = electricSqlUrl;
  }

  const seedEmail = optionalString("seedEmail", "TAXTRACK_SEED_EMAIL");
  if (seedEmail) {
    environment.TAXTRACK_SEED_EMAIL = seedEmail;
  }

  const seedPassword = optionalString("seedPassword", "TAXTRACK_SEED_PASSWORD");
  if (seedPassword) {
    environment.TAXTRACK_SEED_PASSWORD = seedPassword;
  }

  const seedName = optionalString("seedName", "TAXTRACK_SEED_NAME");
  if (seedName) {
    environment.TAXTRACK_SEED_NAME = seedName;
  }

  const sesFromEmail = optionalString("sesFromEmail", "SES_FROM_EMAIL");
  if (sesFromEmail) {
    environment.SES_FROM_EMAIL = sesFromEmail;
  }

  const testEmailRecipient = optionalString(
    "testEmailRecipient",
    "TEST_EMAIL_RECIPIENT",
  );
  if (testEmailRecipient) {
    environment.TEST_EMAIL_RECIPIENT = testEmailRecipient;
  }

  if (sesFromEmail || testEmailRecipient) {
    permissions.push({
      actions: ["ses:SendRawEmail"],
      resources: ["*"],
    });
  }

  return new sst.aws.TanStackStart("TaxTrackWeb", {
    path: "../../webapp/tax-track",
    buildCommand: `NODE_OPTIONS="--max-old-space-size=4096" pnpm build`,
    environment,
    permissions,
    ...(input.network
      ? {
          vpc: {
            privateSubnets: [
              input.network.privateSubnet.id,
              input.network.privateSubnet2.id,
            ],
            securityGroups: [input.network.lambdaSg.id],
          },
        }
      : {}),
    dev: {
      command: "pnpm dev",
      directory: "../../webapp/tax-track",
      title: "TaxTrack web",
    },
  });
}
