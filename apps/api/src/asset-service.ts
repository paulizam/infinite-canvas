import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import {
  assetBlobStoreRegistry,
  type AssetBlobStore,
  type AssetBlobStoreRegistry,
} from "./blob-store.js";
import {
  DomainError,
  type AssetRecord,
  type MediaKind,
  type PlatformRepository,
} from "./domain.js";

export class AssetService {
  private readonly currentProvider: string;
  private readonly blobStores: Readonly<Record<string, AssetBlobStore>>;
  constructor(
    private readonly repository: PlatformRepository,
    blobs: AssetBlobStore | AssetBlobStoreRegistry,
    private readonly maxUploadBytes: number,
  ) {
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0)
      throw new Error("MAX_UPLOAD_BYTES must be a positive integer");
    const registry = assetBlobStoreRegistry(blobs);
    this.currentProvider = registry.currentProvider;
    this.blobStores = registry.stores;
  }
  list(userId: string, workspaceId: string) {
    return this.repository.listAssets(userId, workspaceId);
  }
  async readUpload(request: Request) {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxUploadBytes)
      throw new DomainError("UPLOAD_SIZE_INVALID", 400, "上传文件大小无效");
    if (!request.body) return Buffer.alloc(0);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.maxUploadBytes)
          throw new DomainError("UPLOAD_SIZE_INVALID", 400, "上传文件大小无效");
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }
  async upload(
    userId: string,
    workspaceId: string,
    input: { bytes: Buffer; originalName: string },
  ) {
    if (!input.bytes.length || input.bytes.length > this.maxUploadBytes)
      throw new DomainError("UPLOAD_SIZE_INVALID", 400, "上传文件大小无效");
    const detected = await fileTypeFromBuffer(input.bytes);
    const kind = mediaKind(detected?.mime);
    if (!detected || !kind)
      throw new DomainError("UNSUPPORTED_MEDIA", 400, "不支持的媒体内容");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.repository.findAssetByHash(
      userId,
      workspaceId,
      sha256,
    );
    if (existing) return { asset: existing, deduplicated: true };
    const id = randomUUID();
    const storageKey = `${workspaceId}/${id}.${detected.ext}`;
    const asset: AssetRecord = {
      id,
      workspaceId,
      ownerId: userId,
      storageProvider: this.currentProvider,
      storageKey,
      sha256,
      bytes: input.bytes.length,
      mimeType: detected.mime,
      kind,
      originalName: safeName(input.originalName, detected.ext),
      createdAt: new Date().toISOString(),
      variants: [],
    };
    const previewBytes =
      kind === "image" ? await createPreview(input.bytes) : null;
    if (previewBytes) {
      asset.variants.push({
        kind: "preview",
        storageProvider: this.currentProvider,
        storageKey: `${workspaceId}/${id}.preview.webp`,
        sha256: createHash("sha256").update(previewBytes).digest("hex"),
        bytes: previewBytes.length,
        mimeType: "image/webp",
        createdAt: asset.createdAt,
      });
    }
    const blobs = this.store(this.currentProvider);
    await blobs.put(storageKey, input.bytes, detected.mime);
    try {
      const preview = asset.variants[0];
      if (preview && previewBytes)
        await blobs.put(preview.storageKey, previewBytes, preview.mimeType);
      const stored = await this.repository.createAsset(userId, asset);
      if (stored.id !== id) {
        await blobs.delete(storageKey);
        if (preview) await blobs.delete(preview.storageKey);
      }
      return { asset: stored, deduplicated: stored.id !== id };
    } catch (error) {
      await blobs.delete(storageKey).catch(() => undefined);
      await Promise.all(
        asset.variants.map((variant) =>
          blobs.delete(variant.storageKey).catch(() => undefined),
        ),
      );
      throw error;
    }
  }
  async read(userId: string, assetId: string) {
    const asset = await this.repository.getAsset(userId, assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    const blobs = this.store(asset.storageProvider);
    const url = await blobs.signedReadUrl?.(asset.storageKey, asset.mimeType);
    return url
      ? { asset, url }
      : { asset, bytes: await blobs.get(asset.storageKey) };
  }
  async readBytes(userId: string, assetId: string) {
    const asset = await this.repository.getAsset(userId, assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    return {
      asset,
      bytes: await this.store(asset.storageProvider).get(asset.storageKey),
    };
  }
  async readPreview(userId: string, assetId: string) {
    const asset = await this.repository.getAsset(userId, assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    const variant = asset.variants.find((item) => item.kind === "preview");
    if (!variant)
      throw new DomainError("ASSET_VARIANT_NOT_FOUND", 404, "素材预览不存在");
    const blobs = this.store(variant.storageProvider);
    const url = await blobs.signedReadUrl?.(
      variant.storageKey,
      variant.mimeType,
    );
    return url
      ? { asset, variant, url }
      : { asset, variant, bytes: await blobs.get(variant.storageKey) };
  }
  async delete(userId: string, assetId: string) {
    const asset = await this.repository.deleteAsset(userId, assetId);
    await Promise.all([
      this.store(asset.storageProvider).delete(asset.storageKey),
      ...asset.variants.map((variant) =>
        this.store(variant.storageProvider).delete(variant.storageKey),
      ),
    ]);
    return asset;
  }
  private store(provider: string) {
    const store = this.blobStores[provider];
    if (!store)
      throw new DomainError(
        "ASSET_STORAGE_UNAVAILABLE",
        502,
        `素材存储 ${provider} 未配置`,
      );
    return store;
  }
}
async function createPreview(bytes: Buffer) {
  try {
    return await sharp(bytes, {
      failOn: "error",
      limitInputPixels: 100_000_000,
    })
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
function mediaKind(mime?: string): MediaKind | null {
  if (mime?.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/") || mime === "application/ogg") return "audio";
  if (mime === "application/zip") return "file";
  return null;
}
function safeName(value: string, extension: string) {
  const name = basename(value.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return name || `asset.${extension}`;
}
