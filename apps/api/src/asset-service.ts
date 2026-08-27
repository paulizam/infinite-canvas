import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { AssetBlobStore } from "./blob-store.js";
import {
  DomainError,
  type AssetRecord,
  type MediaKind,
  type PlatformRepository,
} from "./domain.js";

export class AssetService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly blobs: AssetBlobStore,
    private readonly maxUploadBytes: number,
  ) {
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0)
      throw new Error("MAX_UPLOAD_BYTES must be a positive integer");
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
      storageKey,
      sha256,
      bytes: input.bytes.length,
      mimeType: detected.mime,
      kind,
      originalName: safeName(input.originalName, detected.ext),
      createdAt: new Date().toISOString(),
    };
    await this.blobs.put(storageKey, input.bytes, detected.mime);
    try {
      const stored = await this.repository.createAsset(userId, asset);
      if (stored.id !== id) await this.blobs.delete(storageKey);
      return { asset: stored, deduplicated: stored.id !== id };
    } catch (error) {
      await this.blobs.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }
  async read(userId: string, assetId: string) {
    const asset = await this.repository.getAsset(userId, assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    const url = await this.blobs.signedReadUrl?.(
      asset.storageKey,
      asset.mimeType,
    );
    return url
      ? { asset, url }
      : { asset, bytes: await this.blobs.get(asset.storageKey) };
  }
  async readBytes(userId: string, assetId: string) {
    const asset = await this.repository.getAsset(userId, assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    return { asset, bytes: await this.blobs.get(asset.storageKey) };
  }
  async delete(userId: string, assetId: string) {
    const asset = await this.repository.deleteAsset(userId, assetId);
    await this.blobs.delete(asset.storageKey);
    return asset;
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
