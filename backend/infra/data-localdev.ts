import * as aws from "@pulumi/aws";
import type { InfraContext } from "./types";

export interface LocalDataResources {
  storageBucket: aws.s3.Bucket;
}

export function createDataLocalDev(ctx: InfraContext): LocalDataResources {
  const storageBucket = new aws.s3.Bucket(`${ctx.namePrefix}-storage`, {
    tags: {
      Name: `${ctx.namePrefix}-storage`
    }
  });

  new aws.s3.BucketVersioningV2(`${ctx.namePrefix}-storage-versioning`, {
    bucket: storageBucket.id,
    versioningConfiguration: {
      status: "Enabled"
    }
  });

  new aws.s3.BucketCorsConfigurationV2(`${ctx.namePrefix}-storage-cors`, {
    bucket: storageBucket.id,
    corsRules: [
      {
        allowedHeaders: ["*"],
        allowedMethods: ["PUT", "HEAD"],
        allowedOrigins: ["*"],
        exposeHeaders: ["ETag", "x-amz-version-id"],
        maxAgeSeconds: 3000,
      },
    ],
  });

  return {
    storageBucket
  };
}
