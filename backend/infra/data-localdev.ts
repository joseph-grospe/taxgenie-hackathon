import * as aws from "@pulumi/aws";
import type { InfraContext } from "./types";

export interface LocalDataResources {
  artifactsBucket: aws.s3.Bucket;
  sourceFilesBucket: aws.s3.Bucket;
}

export function createDataLocalDev(ctx: InfraContext): LocalDataResources {
  const artifactsBucket = new aws.s3.Bucket(`${ctx.namePrefix}-artifacts`, {
    tags: {
      Name: `${ctx.namePrefix}-artifacts`
    }
  });

  new aws.s3.BucketVersioningV2(`${ctx.namePrefix}-artifacts-versioning`, {
    bucket: artifactsBucket.id,
    versioningConfiguration: {
      status: "Enabled"
    }
  });

  const sourceFilesBucket = new aws.s3.Bucket(`${ctx.namePrefix}-source-files`, {
    tags: {
      Name: `${ctx.namePrefix}-source-files`
    }
  });

  new aws.s3.BucketVersioningV2(`${ctx.namePrefix}-source-files-versioning`, {
    bucket: sourceFilesBucket.id,
    versioningConfiguration: {
      status: "Enabled"
    }
  });

  return {
    artifactsBucket,
    sourceFilesBucket
  };
}
