import { describe, expect, it, vi } from "vitest";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import type { AssetRecord, PlatformRepository } from "./domain.js";

const historical: AssetRecord = {
  id: "asset-old",
  workspaceId: "workspace",
  ownerId: "user",
  storageProvider: "local",
  storageKey: "workspace/old.png",
  sha256: "a".repeat(64),
  bytes: 3,
  mimeType: "image/png",
  kind: "image",
  originalName: "old.png",
  createdAt: new Date(0).toISOString(),
  variants: [],
  lineageRootId: "asset-old",
  version: 1,
  parentAssetIds: [],
  origins: [],
};

describe("AssetService storage provider routing", () => {
  it("[AST-010] derives a version from parents and preserves provenance", async () => {
    let created: AssetRecord | undefined;
    const repository = {
      findAssetByHash: vi.fn(async () => null),
      getAsset: vi.fn(async (_userId: string, id: string) =>
        id === historical.id ? historical : null,
      ),
      createAsset: vi.fn(async (_userId: string, asset: AssetRecord) => {
        created = asset;
        return asset;
      }),
    } as unknown as PlatformRepository;
    const service = new AssetService(repository, new MemoryAssetBlobStore(), 1024 * 1024);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await service.upload("user", "workspace", {
      bytes: png,
      originalName: "derived.png",
      parentAssetIds: [historical.id],
      origin: {
        sourceType: "generation_job",
        sourceId: "job-1",
        metadata: { model: "image-v1" },
      },
    });
    expect(created).toMatchObject({
      lineageRootId: historical.id,
      version: 2,
      parentAssetIds: [historical.id],
      origins: [
        expect.objectContaining({
          sourceType: "generation_job",
          sourceId: "job-1",
          metadata: { model: "image-v1" },
        }),
      ],
    });
  });

  it("reads and deletes historical assets from their immutable provider after a switch [AST-002]", async () => {
    const local = new MemoryAssetBlobStore();
    const s3 = new MemoryAssetBlobStore();
    local.values.set(historical.storageKey, Buffer.from("old"));
    const repository = {
      getAsset: vi.fn(async () => historical),
      deleteAsset: vi.fn(async () => historical),
    } as unknown as PlatformRepository;
    const service = new AssetService(
      repository,
      { currentProvider: "s3", stores: { local, s3 } },
      1024,
    );

    await expect(
      service.readBytes("user", historical.id),
    ).resolves.toMatchObject({ bytes: Buffer.from("old") });
    await service.delete("user", historical.id);
    expect(local.values.has(historical.storageKey)).toBe(false);
    expect(s3.values.size).toBe(0);
  });

  it("fails closed when a historical provider is not configured", async () => {
    const repository = {
      getAsset: vi.fn(async () => historical),
    } as unknown as PlatformRepository;
    const service = new AssetService(
      repository,
      { currentProvider: "s3", stores: { s3: new MemoryAssetBlobStore() } },
      1024,
    );
    await expect(
      service.readBytes("user", historical.id),
    ).rejects.toMatchObject({ code: "ASSET_STORAGE_UNAVAILABLE", status: 502 });
  });

  it("[GEN-015] returns an original provider-signed download without proxying object bytes", async () => {
    const get = vi.fn(async () => Buffer.from("must-not-load"));
    const signedReadUrl = vi.fn(
      async () => "https://objects.example/signed?opaque=1",
    );
    const s3 = { put: vi.fn(), get, delete: vi.fn(), signedReadUrl };
    const asset = { ...historical, storageProvider: "s3" };
    const repository = {
      getAsset: vi.fn(async () => asset),
    } as unknown as PlatformRepository;
    const service = new AssetService(
      repository,
      { currentProvider: "s3", stores: { s3 } },
      1024,
    );

    await expect(service.read("user", asset.id)).resolves.toEqual({
      asset,
      url: "https://objects.example/signed?opaque=1",
    });
    expect(signedReadUrl).toHaveBeenCalledWith(
      asset.storageKey,
      asset.mimeType,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("[AST-003][AST-005][GEN-015] signs the WebP preview independently from the original", async () => {
    const signedReadUrl = vi.fn(
      async (key: string) => `https://objects.example/${key}`,
    );
    const preview = {
      kind: "preview" as const,
      storageProvider: "s3",
      storageKey: "workspace/asset.preview.webp",
      sha256: "b".repeat(64),
      bytes: 12,
      mimeType: "image/webp",
      createdAt: historical.createdAt,
    };
    const asset = { ...historical, storageProvider: "s3", variants: [preview] };
    const repository = {
      getAsset: vi.fn(async () => asset),
    } as unknown as PlatformRepository;
    const service = new AssetService(
      repository,
      {
        currentProvider: "s3",
        stores: {
          s3: { put: vi.fn(), get: vi.fn(), delete: vi.fn(), signedReadUrl },
        },
      },
      1024,
    );
    await expect(service.readPreview("user", asset.id)).resolves.toMatchObject({
      asset,
      variant: preview,
      url: "https://objects.example/workspace/asset.preview.webp",
    });
    expect(signedReadUrl).toHaveBeenCalledWith(
      preview.storageKey,
      "image/webp",
    );
  });
});
