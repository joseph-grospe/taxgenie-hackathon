import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  VersionedS3CleanupError,
  deleteVersionedS3Objects,
} from "./versioned-s3-retention";

function s3Client(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

describe("deleteVersionedS3Objects", () => {
  it("paginates with both markers, filters exact keys, and deletes versions and markers", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [
          { Key: "uploads/source.pdf", VersionId: "v2", Size: 12 },
          { Key: "uploads/source.pdf-copy", VersionId: "other", Size: 99 },
        ],
        DeleteMarkers: [{ Key: "uploads/source.pdf", VersionId: "delete-1" }],
        IsTruncated: true,
        NextKeyMarker: "uploads/source.pdf",
        NextVersionIdMarker: "v1",
      })
      .mockResolvedValueOnce({
        Versions: [
          { Key: "uploads/source.pdf", VersionId: "null", Size: 3 },
          { Key: "uploads/source.pdf", VersionId: "v2", Size: 12 },
        ],
        DeleteMarkers: [{ Key: "uploads/source.pdf", VersionId: "delete-1" }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Versions: [
          { Key: "uploads/source.pdf-copy", VersionId: "other", Size: 99 },
        ],
        IsTruncated: false,
      });

    const result = await deleteVersionedS3Objects(
      s3Client(send),
      "taxtrack-storage",
      ["uploads/source.pdf", "uploads/source.pdf"],
    );

    expect(result).toEqual({
      objectVersionCount: 2,
      deleteMarkerCount: 1,
      versionByteCount: 15,
    });
    expect(send).toHaveBeenCalledTimes(4);

    const secondList = send.mock.calls[1]?.[0];
    expect(secondList).toBeInstanceOf(ListObjectVersionsCommand);
    expect(secondList.input).toMatchObject({
      Prefix: "uploads/source.pdf",
      KeyMarker: "uploads/source.pdf",
      VersionIdMarker: "v1",
    });

    const deleteCommand = send.mock.calls[2]?.[0];
    expect(deleteCommand).toBeInstanceOf(DeleteObjectsCommand);
    expect(deleteCommand.input.Delete.Objects).toEqual(
      expect.arrayContaining([
        { Key: "uploads/source.pdf", VersionId: "v2" },
        { Key: "uploads/source.pdf", VersionId: "null" },
        { Key: "uploads/source.pdf", VersionId: "delete-1" },
      ]),
    );
    expect(deleteCommand.input.Delete.Objects).toHaveLength(3);
  });

  it("chunks version-specific deletes at 1,000 targets", async () => {
    const versions = Array.from({ length: 1001 }, (_, index) => ({
      Key: "uploads/large.pdf",
      VersionId: `version-${index}`,
      Size: 1,
    }));
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Versions: versions, IsTruncated: false })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: false });

    const result = await deleteVersionedS3Objects(
      s3Client(send),
      "taxtrack-storage",
      ["uploads/large.pdf"],
    );

    const deleteCommands = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectsCommand);
    expect(deleteCommands).toHaveLength(2);
    expect(deleteCommands[0]?.input.Delete?.Objects).toHaveLength(1000);
    expect(deleteCommands[1]?.input.Delete?.Objects).toHaveLength(1);
    expect(result.versionByteCount).toBe(1001);
  });

  it("fails when S3 rejects an individual version deletion", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [
          { Key: "uploads/source.pdf", VersionId: "v1", Size: 10 },
          { Key: "uploads/source.pdf", VersionId: "v2", Size: 20 },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Errors: [
          { Key: "uploads/source.pdf", VersionId: "v2", Code: "Denied" },
        ],
      });

    await expect(
      deleteVersionedS3Objects(s3Client(send), "taxtrack-storage", [
        "uploads/source.pdf",
      ]),
    ).rejects.toMatchObject({
      name: "VersionedS3CleanupError",
      phase: "delete_versions",
      failedVersionDeleteCount: 1,
      stats: {
        objectVersionCount: 2,
        deleteMarkerCount: 0,
        versionByteCount: 30,
      },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("fails when a version-delete request throws", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [{ Key: "uploads/source.pdf", VersionId: "v1", Size: 10 }],
        IsTruncated: false,
      })
      .mockRejectedValueOnce(new Error("network unavailable"));

    await expect(
      deleteVersionedS3Objects(s3Client(send), "taxtrack-storage", [
        "uploads/source.pdf",
      ]),
    ).rejects.toMatchObject({
      phase: "delete_versions",
      failedVersionDeleteCount: 1,
      stats: {
        objectVersionCount: 1,
        versionByteCount: 10,
      },
    });
  });

  it("re-enumerates only remaining versions after a partial cleanup", async () => {
    const versions = Array.from({ length: 1001 }, (_, index) => ({
      Key: "uploads/large.pdf",
      VersionId: `version-${index}`,
      Size: 1,
    }));
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Versions: versions, IsTruncated: false })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Errors: [
          {
            Key: "uploads/large.pdf",
            VersionId: "version-1000",
            Code: "Denied",
          },
        ],
      })
      .mockResolvedValueOnce({
        Versions: [
          { Key: "uploads/large.pdf", VersionId: "version-1000", Size: 1 },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: false });
    const s3 = s3Client(send);

    await expect(
      deleteVersionedS3Objects(s3, "taxtrack-storage", ["uploads/large.pdf"]),
    ).rejects.toMatchObject({
      phase: "delete_versions",
      failedVersionDeleteCount: 1,
    });
    await expect(
      deleteVersionedS3Objects(s3, "taxtrack-storage", ["uploads/large.pdf"]),
    ).resolves.toEqual({
      objectVersionCount: 1,
      deleteMarkerCount: 0,
      versionByteCount: 1,
    });
  });

  it("fails closed when version listing throws", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("access denied"));

    await expect(
      deleteVersionedS3Objects(s3Client(send), "taxtrack-storage", [
        "uploads/source.pdf",
      ]),
    ).rejects.toMatchObject({
      name: "VersionedS3CleanupError",
      phase: "list_versions",
    });
  });

  it("rejects malformed exact-key version entries", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Versions: [{ Key: "uploads/source.pdf", Size: 10 }],
      IsTruncated: false,
    });

    await expect(
      deleteVersionedS3Objects(s3Client(send), "taxtrack-storage", [
        "uploads/source.pdf",
      ]),
    ).rejects.toBeInstanceOf(VersionedS3CleanupError);
  });

  it("verifies that no version or delete marker remains", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [{ Key: "uploads/source.pdf", VersionId: "v1", Size: 10 }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        DeleteMarkers: [
          { Key: "uploads/source.pdf", VersionId: "concurrent-delete" },
        ],
        IsTruncated: false,
      });

    await expect(
      deleteVersionedS3Objects(s3Client(send), "taxtrack-storage", [
        "uploads/source.pdf",
      ]),
    ).rejects.toMatchObject({
      phase: "verify_empty",
      remainingVersionTargetCount: 1,
    });
  });

  it("preserves discovery counts when verification listing fails", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [{ Key: "uploads/source.pdf", VersionId: "v1", Size: 10 }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("verification unavailable"));

    await expect(
      deleteVersionedS3Objects(s3Client(send), "taxtrack-storage", [
        "uploads/source.pdf",
      ]),
    ).rejects.toMatchObject({
      phase: "verify_empty",
      stats: {
        objectVersionCount: 1,
        deleteMarkerCount: 0,
        versionByteCount: 10,
      },
    });
  });
});
