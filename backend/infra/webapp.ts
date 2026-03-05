/// <reference path="./.sst/platform/config.d.ts" />

import * as pulumi from "@pulumi/pulumi";
import { optionalString, requiredSecret } from "./config";

type SourceBucketRef = {
  name?: string | pulumi.Input<string>;
  arn?: string | pulumi.Input<string>;
};

type CreateWebTrackFrontendInput = {
  s3Bucket?: SourceBucketRef;
  region?: string;
  s3Prefix?: string;
  s3MaxKeys?: string | number;
  databaseUrl?: string | pulumi.Input<string>;
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
  const effectiveBucketArn = bucketArn ??
    (bucketName ? pulumi.interpolate`arn:aws:s3:::${bucketName}` : undefined);
  const s3Region = firstValue(
    input.region,
    process.env.S3_REGION,
  );
  const environment: Record<string, string | pulumi.Input<string>> = {
    S3_REGION: s3Region || "ap-southeast-1",
  };
  const permissions = effectiveBucketArn
    ? [
        {
          actions: ["s3:ListBucket"],
          resources: [
            effectiveBucketArn,
          ],
        },
        {
          actions: ["s3:GetObject"],
          resources: [pulumi.interpolate`${effectiveBucketArn}/*`],
        },
      ]
    : [];

  if (bucketName) {
    environment.S3_BUCKET_NAME = bucketName;
  }

  const prefix = firstValue(input.s3Prefix, process.env.S3_PREFIX);
  if (prefix) {
    environment.S3_PREFIX = prefix;
  }

  const maxKeys = firstValue(input.s3MaxKeys?.toString(), process.env.S3_MAX_KEYS);
  if (maxKeys) {
    environment.S3_MAX_KEYS = maxKeys;
  }

  const betterAuthSecret = requiredSecret("betterAuthSecret", "BETTER_AUTH_SECRET");
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

  return new sst.aws.TanStackStart("TaxTrackWeb", {
    path: "../../webapp/tax-track",
    buildCommand: "pnpm build",
    environment,
    permissions,
    dev: {
      command: "pnpm dev",
      directory: "../../webapp/tax-track",
      title: "TaxTrack web"
    },
  });
}
