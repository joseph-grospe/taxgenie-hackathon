import assert from "node:assert/strict";
import test from "node:test";
import type { Storage } from "@google-cloud/storage";

import {
  buildCloudStorageUri,
  GoogleCloudObjectStorage,
  parseCloudStorageUri,
} from "./object-storage";

test("cloud storage URIs build and parse gs:// locations", () => {
  const uri = buildCloudStorageUri({
    bucket: "taxgenie-documents",
    key: "/v2/source/a.pdf",
  });

  assert.equal(uri, "gs://taxgenie-documents/v2/source/a.pdf");
  assert.deepEqual(parseCloudStorageUri(uri), {
    bucket: "taxgenie-documents",
    key: "v2/source/a.pdf",
    uri,
  });
  assert.equal(parseCloudStorageUri("v2/source/a.pdf"), null);
  assert.deepEqual(parseCloudStorageUri("/v2/source/a.pdf", "documents"), {
    bucket: "documents",
    key: "v2/source/a.pdf",
    uri: "gs://documents/v2/source/a.pdf",
  });
});

test("GCS metadata exposes the immutable object generation", async () => {
  const client = {
    bucket: () => ({
      file: () => ({
        getMetadata: async () => [
          {
            contentType: "application/pdf",
            size: "2048",
            etag: "etag-1",
            generation: "1720000000000000",
          },
        ],
      }),
    }),
  } as unknown as Storage;

  const storage = new GoogleCloudObjectStorage(client);
  assert.deepEqual(
    await storage.getMetadata({ bucket: "documents", key: "source/a.pdf" }),
    {
      contentType: "application/pdf",
      size: 2048,
      etag: "etag-1",
      generation: "1720000000000000",
    },
  );
});

test("GCS adapter creates 15-minute V4 upload and download URLs", async (t) => {
  t.mock.method(Date, "now", () => 1_000_000);
  const signedUrlCalls: Array<Record<string, unknown>> = [];
  const urls = ["https://upload.example.test", "https://download.example.test"];
  const client = {
    bucket: () => ({
      file: () => ({
        getSignedUrl: async (input: Record<string, unknown>) => {
          signedUrlCalls.push(input);
          return [urls.shift()];
        },
      }),
    }),
  } as unknown as Storage;
  const storage = new GoogleCloudObjectStorage(client);

  assert.equal(
    await storage.createSignedUploadUrl({
      bucket: "documents",
      key: "source/a.pdf",
      contentType: "application/pdf",
      expiresInSeconds: 900,
    }),
    "https://upload.example.test",
  );
  assert.equal(
    await storage.createSignedDownloadUrl({
      bucket: "documents",
      key: "source/a.pdf",
      expiresInSeconds: 900,
    }),
    "https://download.example.test",
  );
  assert.deepEqual(signedUrlCalls, [
    {
      version: "v4",
      action: "write",
      expires: 1_900_000,
      contentType: "application/pdf",
    },
    { version: "v4", action: "read", expires: 1_900_000 },
  ]);
});
