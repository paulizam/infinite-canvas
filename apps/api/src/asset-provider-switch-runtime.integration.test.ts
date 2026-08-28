import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AssetService } from "./asset-service.js";
import { LocalAssetBlobStore, S3AssetBlobStore } from "./blob-store.js";
import { PostgresPlatformRepository } from "./postgres-repository.js";

const databaseUrl = process.env.ASSET_PROVIDER_TEST_DATABASE_URL?.trim();
const endpoint = process.env.S3_TEST_ENDPOINT?.trim();
const accessKeyId = process.env.S3_TEST_ACCESS_KEY?.trim() || "minioadmin";
const secretAccessKey = process.env.S3_TEST_SECRET_KEY?.trim() || "minioadmin";
const enabled = Boolean(databaseUrl && endpoint);

describe.runIf(enabled)("[AST-002] PostgreSQL metadata and S3 provider switch", () => {
  const bucket = `infinite-canvas-switch-${randomUUID()}`;
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const repository = new PostgresPlatformRepository(databaseUrl!);
  const s3Client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  let localRoot: string;

  beforeAll(async () => {
    localRoot = await mkdtemp(join(tmpdir(), "ic-provider-switch-"));
    await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    const createdAt = new Date().toISOString();
    await repository.createUserWithWorkspace({
      user: { id: userId, email: `${userId}@runtime.invalid`, name: "Runtime", passwordHash: "runtime-only", createdAt },
      workspace: { id: workspaceId, name: "Provider switch runtime", createdAt },
      membership: { workspaceId, userId, role: "owner" },
    });
  });

  afterAll(async () => {
    await s3Client.send(new DeleteBucketCommand({ Bucket: bucket }));
    s3Client.destroy();
    await (repository as unknown as { pool: { end(): Promise<void> } }).pool.end();
    await rm(localRoot, { recursive: true, force: true });
  });

  it("keeps historical local assets readable after new uploads switch to S3", async () => {
    const local = new LocalAssetBlobStore(localRoot);
    const s3 = new S3AssetBlobStore(bucket, { region: "us-east-1", endpoint, accessKeyId, secretAccessKey, forcePathStyle: true });
    const localService = new AssetService(repository, { currentProvider: "local", stores: { local, s3 } }, 1024 * 1024);
    const localBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const localResult = await localService.upload(userId, workspaceId, { bytes: localBytes, originalName: "local.png" });
    expect(localResult.asset.storageProvider).toBe("local");
    await expect(readFile(join(localRoot, localResult.asset.storageKey))).resolves.toEqual(localBytes);

    const switchedService = new AssetService(repository, { currentProvider: "s3", stores: { local, s3 } }, 1024 * 1024);
    const s3Bytes = await sharp({ create: { width: 3, height: 3, channels: 4, background: "#0000ff" } }).png().toBuffer();
    const s3Result = await switchedService.upload(userId, workspaceId, { bytes: s3Bytes, originalName: "s3.png" });
    expect(s3Result.asset.storageProvider).toBe("s3");

    await expect(switchedService.readBytes(userId, localResult.asset.id)).resolves.toMatchObject({ bytes: localBytes });
    await expect(switchedService.readBytes(userId, s3Result.asset.id)).resolves.toMatchObject({ bytes: s3Bytes });
    await expect(repository.listAssets(userId, workspaceId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: localResult.asset.id, storageProvider: "local" }),
        expect.objectContaining({ id: s3Result.asset.id, storageProvider: "s3" }),
      ]),
    );

    await switchedService.delete(userId, localResult.asset.id);
    await switchedService.delete(userId, s3Result.asset.id);
    await expect(repository.getAsset(userId, localResult.asset.id)).resolves.toBeNull();
    await expect(repository.getAsset(userId, s3Result.asset.id)).resolves.toBeNull();
  });
});
