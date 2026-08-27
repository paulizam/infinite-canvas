import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { PostgresPlatformRepository } from "./postgres-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

const databaseUrl = required("DATABASE_URL");
const sessionTtlSeconds = Number(required("SESSION_TTL_SECONDS"));
const repository = new PostgresPlatformRepository(databaseUrl);
const app = createApp({
  identity: new IdentityService(repository, sessionTtlSeconds * 1000),
  workspaces: new WorkspaceService(repository),
  projects: new ProjectService(repository),
  secureCookies: process.env.NODE_ENV === "production",
});
const port = Number(process.env.PORT || "3001");
serve({ fetch: app.fetch, port }, (info) =>
  console.log(`API listening on http://localhost:${info.port}`),
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
