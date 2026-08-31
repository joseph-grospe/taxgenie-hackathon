import { Storage } from "@google-cloud/storage";

export interface ObjectLocation {
  bucket: string;
  key: string;
}

export interface ObjectMetadata {
  contentType?: string;
  size: number;
  etag?: string;
  generation?: string;
}

export interface WriteObjectInput extends ObjectLocation {
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}

export interface SignedObjectUrlInput extends ObjectLocation {
  expiresInSeconds: number;
  contentType?: string;
}

export interface ObjectStorage {
  getMetadata(location: ObjectLocation): Promise<ObjectMetadata>;
  read(location: ObjectLocation): Promise<Uint8Array>;
  write(input: WriteObjectInput): Promise<void>;
  createSignedUploadUrl(input: SignedObjectUrlInput): Promise<string>;
  createSignedDownloadUrl(input: SignedObjectUrlInput): Promise<string>;
}

export interface ParsedCloudStorageUri extends ObjectLocation {
  uri: string;
}

export function buildCloudStorageUri(location: ObjectLocation): string {
  const key = location.key.replace(/^\/+/, "");
  return `gs://${location.bucket}/${key}`;
}

export function parseCloudStorageUri(
  input: string | undefined,
  defaultBucket?: string,
): ParsedCloudStorageUri | null {
  const value = input?.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("gs://")) {
    const withoutScheme = value.slice("gs://".length);
    const firstSlash = withoutScheme.indexOf("/");
    if (firstSlash <= 0 || firstSlash === withoutScheme.length - 1) {
      return null;
    }
    return {
      bucket: withoutScheme.slice(0, firstSlash),
      key: withoutScheme.slice(firstSlash + 1),
      uri: value,
    };
  }

  if (!defaultBucket || value.includes("://")) {
    return null;
  }

  const key = value.replace(/^\/+/, "");
  if (!key) {
    return null;
  }
  return {
    bucket: defaultBucket,
    key,
    uri: buildCloudStorageUri({ bucket: defaultBucket, key }),
  };
}

export class GoogleCloudObjectStorage implements ObjectStorage {
  constructor(private readonly client: Storage = new Storage()) {}

  async getMetadata(location: ObjectLocation): Promise<ObjectMetadata> {
    const [metadata] = await this.client
      .bucket(location.bucket)
      .file(location.key)
      .getMetadata();

    return {
      contentType: metadata.contentType,
      size: Number(metadata.size ?? 0),
      etag: metadata.etag,
      generation:
        metadata.generation === undefined
          ? undefined
          : String(metadata.generation),
    };
  }

  async read(location: ObjectLocation): Promise<Uint8Array> {
    const [contents] = await this.client
      .bucket(location.bucket)
      .file(location.key)
      .download();
    return contents;
  }

  async write(input: WriteObjectInput): Promise<void> {
    await this.client.bucket(input.bucket).file(input.key).save(input.body, {
      resumable: false,
      contentType: input.contentType,
      metadata: input.cacheControl
        ? { cacheControl: input.cacheControl }
        : undefined,
    });
  }

  async createSignedUploadUrl(input: SignedObjectUrlInput): Promise<string> {
    const [url] = await this.client
      .bucket(input.bucket)
      .file(input.key)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + input.expiresInSeconds * 1_000,
        contentType: input.contentType,
      });
    return url;
  }

  async createSignedDownloadUrl(
    input: SignedObjectUrlInput,
  ): Promise<string> {
    const [url] = await this.client
      .bucket(input.bucket)
      .file(input.key)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + input.expiresInSeconds * 1_000,
      });
    return url;
  }
}
