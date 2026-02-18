/// <reference path="./.sst/platform/config.d.ts" />

import * as pulumi from "@pulumi/pulumi";

type SourceBucketRef = {
  name?: string | pulumi.Input<string>;
  arn?: string | pulumi.Input<string>;
};

type CreateWebTrackFrontendInput = {
  s3Bucket?: SourceBucketRef;
  region?: string;
  s3Prefix?: string;
  s3MaxKeys?: string | number;
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
  const s3Region = firstValue(
    input.region,
    process.env.S3_REGION,
  );
  const environment: Record<string, string | pulumi.Input<string>> = {
    S3_REGION: s3Region || "ap-southeast-1",
  };
  const permissions = bucketArn
    ? [
        {
          actions: ["s3:ListBucket"],
          resources: [bucketArn, pulumi.interpolate`${bucketArn}/*`],
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
