import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { PostgresPlatformRepository } from "./postgres-repository.js";
import { CollaborationHub } from "./collaboration.js";
import { AssetService } from "./asset-service.js";
import { LocalAssetBlobStore, S3AssetBlobStore } from "./blob-store.js";
import { PostgresGenerationJobRepository } from "./postgres-generation-job-repository.js";
import { GenerationJobService } from "./generation-job-service.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

const databaseUrl = required("DATABASE_URL");
const sessionTtlSeconds = Number(required("SESSION_TTL_SECONDS"));
const repository = new PostgresPlatformRepository(databaseUrl);
const identity = new IdentityService(repository, sessionTtlSeconds * 1000);
const projects = new ProjectService(repository);
const jobRepository = new PostgresGenerationJobRepository(databaseUrl);
const assets = new AssetService(
  repository,
  createBlobStore(),
  Number(required("MAX_UPLOAD_BYTES")),
);
const collaboration = new CollaborationHub(
  identity,
  projects,
  new Set(
    required("COLLABORATION_ORIGINS")
      .split(",")
      .map((origin) => new URL(origin.trim()).origin),
  ),
);
const app = createApp({
  identity,
  workspaces: new WorkspaceService(repository),
  projects,
  assets,
  jobs: new GenerationJobService(repository, jobRepository),
  jobRepository,
  workerToken: strongWorkerToken(),
  collaboration,
  secureCookies: process.env.NODE_ENV === "production",
});
const port = Number(process.env.PORT || "3001");
const server = serve({ fetch: app.fetch, port }, (info) =>
  console.log(`API listening on http://localhost:${info.port}`),
);
collaboration.attach(server as import("node:http").Server);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function strongWorkerToken() {
  const token = required("WORKER_TOKEN");
  if (token.length < 32)
    throw new Error("WORKER_TOKEN must contain at least 32 characters");
  return token;
}

function createBlobStore() {
  const driver = required("BLOB_STORAGE_DRIVER");
  if (driver === "local")
    return new LocalAssetBlobStore(required("ASSET_LOCAL_ROOT"));
  if (driver === "s3")
    return new S3AssetBlobStore(required("S3_BUCKET"), {
      region: required("S3_REGION"),
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  throw new Error(`Unsupported BLOB_STORAGE_DRIVER: ${driver}`);
}
