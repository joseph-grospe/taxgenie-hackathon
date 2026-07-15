import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ObjectIdentifier,
  type S3Client,
} from "@aws-sdk/client-s3";

export type S3CleanupFailurePhase =
  | "list_versions"
  | "delete_versions"
  | "verify_empty";

export type VersionedS3CleanupStats = {
  objectVersionCount: number;
  deleteMarkerCount: number;
  versionByteCount: number;
};

type VersionedObjectTarget = ObjectIdentifier & {
  Key: string;
  VersionId: string;
  size: number;
  kind: "object_version" | "delete_marker";
};

export class VersionedS3CleanupError extends Error {
  readonly phase: S3CleanupFailurePhase;
  readonly stats: VersionedS3CleanupStats;
  readonly failedVersionDeleteCount: number;
  readonly remainingVersionTargetCount: number;

  constructor(
    message: string,
    input: {
      phase: S3CleanupFailurePhase;
      stats?: VersionedS3CleanupStats;
      failedVersionDeleteCount?: number;
      remainingVersionTargetCount?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: input.cause });
    this.name = "VersionedS3CleanupError";
    this.phase = input.phase;
    this.stats = input.stats ?? emptyVersionedS3CleanupStats();
    this.failedVersionDeleteCount = input.failedVersionDeleteCount ?? 0;
    this.remainingVersionTargetCount = input.remainingVersionTargetCount ?? 0;
  }
}

const deleteObjectChunkSize = 1000;

export function emptyVersionedS3CleanupStats(): VersionedS3CleanupStats {
  return {
    objectVersionCount: 0,
    deleteMarkerCount: 0,
    versionByteCount: 0,
  };
}

function targetIdentity(
  target: Pick<VersionedObjectTarget, "Key" | "VersionId">,
) {
  return `${target.Key}\u0000${target.VersionId}`;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function cleanupError(
  message: string,
  input: ConstructorParameters<typeof VersionedS3CleanupError>[1],
) {
  return new VersionedS3CleanupError(message, input);
}

function summarizeTargets(
  targets: Iterable<VersionedObjectTarget>,
): VersionedS3CleanupStats {
  const stats = emptyVersionedS3CleanupStats();
  for (const target of targets) {
    if (target.kind === "object_version") {
      stats.objectVersionCount += 1;
      stats.versionByteCount += target.size;
    } else {
      stats.deleteMarkerCount += 1;
    }
  }
  return stats;
}

async function discoverVersionTargets(
  s3: S3Client,
  bucket: string,
  keys: string[],
  phase: "list_versions" | "verify_empty",
): Promise<{
  targets: VersionedObjectTarget[];
  stats: VersionedS3CleanupStats;
}> {
  const targetsByIdentity = new Map<string, VersionedObjectTarget>();
  const uniqueKeys = Array.from(new Set(keys));

  for (const key of uniqueKeys) {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    while (true) {
      let response;
      try {
        response = await s3.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: key,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          }),
        );
      } catch (error) {
        throw cleanupError("Failed to list S3 object versions for retention.", {
          phase,
          stats: summarizeTargets(targetsByIdentity.values()),
          cause: error,
        });
      }

      for (const version of response.Versions ?? []) {
        if (version.Key !== key) {
          continue;
        }
        if (typeof version.VersionId !== "string" || !version.VersionId) {
          throw cleanupError(
            "S3 returned an object version without a version ID.",
            {
              phase,
              stats: summarizeTargets(targetsByIdentity.values()),
            },
          );
        }

        const target: VersionedObjectTarget = {
          Key: key,
          VersionId: version.VersionId,
          size: version.Size ?? 0,
          kind: "object_version",
        };
        targetsByIdentity.set(targetIdentity(target), target);
      }

      for (const marker of response.DeleteMarkers ?? []) {
        if (marker.Key !== key) {
          continue;
        }
        if (typeof marker.VersionId !== "string" || !marker.VersionId) {
          throw cleanupError(
            "S3 returned a delete marker without a version ID.",
            {
              phase,
              stats: summarizeTargets(targetsByIdentity.values()),
            },
          );
        }

        const target: VersionedObjectTarget = {
          Key: key,
          VersionId: marker.VersionId,
          size: 0,
          kind: "delete_marker",
        };
        targetsByIdentity.set(targetIdentity(target), target);
      }

      if (!response.IsTruncated) {
        break;
      }

      const nextKeyMarker = response.NextKeyMarker;
      const nextVersionIdMarker = response.NextVersionIdMarker;
      if (
        !nextKeyMarker ||
        (nextKeyMarker === keyMarker && nextVersionIdMarker === versionIdMarker)
      ) {
        throw cleanupError(
          "S3 returned a truncated object-version page without advancing its markers.",
          {
            phase,
            stats: summarizeTargets(targetsByIdentity.values()),
          },
        );
      }

      keyMarker = nextKeyMarker;
      versionIdMarker = nextVersionIdMarker;
    }
  }

  const targets = Array.from(targetsByIdentity.values());
  return {
    targets,
    stats: summarizeTargets(targets),
  };
}

export async function deleteVersionedS3Objects(
  s3: S3Client,
  bucket: string,
  keys: string[],
): Promise<VersionedS3CleanupStats> {
  const discovery = await discoverVersionTargets(
    s3,
    bucket,
    keys,
    "list_versions",
  );

  for (const chunk of chunkItems(discovery.targets, deleteObjectChunkSize)) {
    let response;
    try {
      response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map(({ Key, VersionId }) => ({ Key, VersionId })),
            Quiet: true,
          },
        }),
      );
    } catch (error) {
      throw cleanupError("Failed to delete S3 object versions for retention.", {
        phase: "delete_versions",
        stats: discovery.stats,
        failedVersionDeleteCount: chunk.length,
        cause: error,
      });
    }

    const failedVersionDeleteCount = response.Errors?.length ?? 0;
    if (failedVersionDeleteCount > 0) {
      throw cleanupError("S3 rejected one or more version deletions.", {
        phase: "delete_versions",
        stats: discovery.stats,
        failedVersionDeleteCount,
      });
    }
  }

  let verification;
  try {
    verification = await discoverVersionTargets(
      s3,
      bucket,
      keys,
      "verify_empty",
    );
  } catch (error) {
    if (error instanceof VersionedS3CleanupError) {
      throw cleanupError(error.message, {
        phase: "verify_empty",
        stats: discovery.stats,
        remainingVersionTargetCount: error.remainingVersionTargetCount,
        cause: error,
      });
    }
    throw error;
  }
  if (verification.targets.length > 0) {
    throw cleanupError(
      "S3 object versions or delete markers remained after retention cleanup.",
      {
        phase: "verify_empty",
        stats: discovery.stats,
        remainingVersionTargetCount: verification.targets.length,
      },
    );
  }

  return discovery.stats;
}
