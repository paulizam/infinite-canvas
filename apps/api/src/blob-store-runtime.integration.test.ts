import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3AssetBlobStore } from "./blob-store.js";

const endpoint = process.env.S3_TEST_ENDPOINT?.trim();
const accessKeyId = process.env.S3_TEST_ACCESS_KEY?.trim() || "minioadmin";
const secretAccessKey = process.env.S3_TEST_SECRET_KEY?.trim() || "minioadmin";
const bucket = `infinite-canvas-${randomUUID()}`;
const client = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

describe.runIf(Boolean(endpoint))("S3 blob store runtime [AST-005]", () => {
  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  });

  it("round-trips bytes, serves a signed URL, and deletes the object", async () => {
    const store = new S3AssetBlobStore(bucket, {
      region: "us-east-1",
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    });
    const key = "workspace/runtime/片段.bin";
    const bytes = Buffer.from([0, 1, 2, 127, 255]);

    await store.put(key, bytes, "application/octet-stream");
    await expect(store.get(key)).resolves.toEqual(bytes);

    const signedUrl = await store.signedReadUrl(
      key,
      "application/octet-stream",
    );
    const response = await fetch(signedUrl);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);

    await store.delete(key);
    await expect(store.get(key)).rejects.toThrow();
  });
});
