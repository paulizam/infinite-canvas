import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { PostgresPlatformRepository } from "./postgres-repository.js";
import { CollaborationHub } from "./collaboration.js";
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
