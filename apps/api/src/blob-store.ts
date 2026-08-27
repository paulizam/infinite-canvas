import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface AssetBlobStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedReadUrl?(key: string, contentType: string): Promise<string>;
}

export class LocalAssetBlobStore implements AssetBlobStore {
  constructor(private readonly root: string) {}
  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  private path(key: string) {
    const root = resolve(this.root);
    const target = resolve(root, key);
    if (!target.startsWith(`${root}${sep}`))
      throw new Error("Invalid blob key");
    return target;
  }
}

export class S3AssetBlobStore implements AssetBlobStore {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    config: {
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    },
  ) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: contentType,
      }),
    );
  }
  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error("Blob not found");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  signedReadUrl(key: string, contentType: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
      }),
      { expiresIn: 600 },
    );
  }
}

export class MemoryAssetBlobStore implements AssetBlobStore {
  readonly values = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.values.set(key, bytes);
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("Blob not found");
    return value;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}
