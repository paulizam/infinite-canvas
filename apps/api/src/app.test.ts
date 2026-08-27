import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

let app: ReturnType<typeof createApp>;
let repository: MemoryPlatformRepository;
beforeEach(() => {
  repository = new MemoryPlatformRepository();
  const jobRepository = new MemoryGenerationJobRepository();
  app = createApp({
    identity: new IdentityService(repository, 60_000),
    workspaces: new WorkspaceService(repository),
    projects: new ProjectService(repository),
    assets: new AssetService(
      repository,
      new MemoryAssetBlobStore(),
      1024 * 1024,
    ),
    jobs: new GenerationJobService(repository, jobRepository),
    jobRepository,
    workerToken: "test-worker-token-32-characters-long",
    workerStaleMs: 120_000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "test-maintenance-token-32-characters",
    secureCookies: false,
  });
});

async function register(email = "creator@example.com", name = "创作者") {
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-password", name }),
  });
  const body = (await response.json()) as {
    data: { user: { id: string }; workspace: { id: string } };
  };
  return {
    response,
    body,
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}

describe("cloud workspace API", () => {
  it("registers, authenticates and logs out a session", async () => {
    const { response, body, cookie } = await register();
    expect(response.status).toBe(201);
    expect(body.data.user.id).toBeTruthy();
    const me = await app.request("/api/v1/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    const logout = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    expect(
      (await app.request("/api/v1/me", { headers: { cookie } })).status,
    ).toBe(401);
  });
  it("creates a project and applies an idempotent revision mutation", async () => {
    const { body, cookie } = await register();
    const created = await app.request(
      `/api/v1/workspaces/${body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "云画布" }),
      },
    );
    const project = (
      (await created.json()) as {
        data: { id: string; document: { revision: number } };
      }
    ).data;
    expect(project.document.revision).toBe(0);
    const mutation = {
      mutationId: "m1",
      projectId: project.id,
      baseRevision: 0,
      clientId: "tab-1",
      createdAt: new Date().toISOString(),
      operations: [{ type: "document.patch", patch: { title: "新标题" } }],
    };
    const first = await app.request(
      `/api/v1/projects/${project.id}/mutations`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(mutation),
      },
    );
    const firstData = (
      (await first.json()) as {
        data: {
          project: { document: { revision: number; title: string } };
          replayed: boolean;
        };
      }
    ).data;
    expect(firstData.project.document).toMatchObject({
      revision: 1,
      title: "新标题",
    });
    expect(firstData.replayed).toBe(false);
    const replay = await app.request(
      `/api/v1/projects/${project.id}/mutations`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(mutation),
      },
    );
    expect(
      ((await replay.json()) as { data: { replayed: boolean } }).data.replayed,
    ).toBe(true);
    const conflict = { ...mutation, mutationId: "m2" };
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}/mutations`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(conflict),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}`, {
          method: "DELETE",
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
  });
  it("prevents cross-workspace project access", async () => {
    const owner = await register();
    const created = await app.request(
      `/api/v1/workspaces/${owner.body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "私有" }),
      },
    );
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    const outsider = await register("other@example.com", "其他人");
    expect(
      (
        await app.request(`/api/v1/projects/${id}`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/v1/workspaces/${owner.body.data.workspace.id}/projects`,
          { headers: { cookie: outsider.cookie } },
        )
      ).status,
    ).toBe(403);
  });
  it("allows viewers to read but rejects their entire mutation batch before any patch applies", async () => {
    const owner = await register();
    const created = await app.request(
      `/api/v1/workspaces/${owner.body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "只读画布" }),
      },
    );
    const project = ((await created.json()) as { data: { id: string } }).data;
    const viewer = await register("viewer@example.com", "审阅者");
    await repository.createWorkspace(
      {
        id: owner.body.data.workspace.id,
        name: "共享空间",
        createdAt: new Date().toISOString(),
      },
      {
        workspaceId: owner.body.data.workspace.id,
        userId: viewer.body.data.user.id,
        role: "viewer",
      },
    );
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}`, {
          headers: { cookie: viewer.cookie },
        })
      ).status,
    ).toBe(200);
    const denied = await app.request(
      `/api/v1/projects/${project.id}/mutations`,
      {
        method: "POST",
        headers: { cookie: viewer.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: "viewer-batch",
          projectId: project.id,
          baseRevision: 0,
          clientId: "viewer-tab",
          createdAt: new Date().toISOString(),
          operations: [
            { type: "document.patch", patch: { title: "越权标题" } },
            { type: "viewport.set", viewport: { x: 9, y: 9, k: 2 } },
          ],
        }),
      },
    );
    expect(denied.status).toBe(403);
    const after = (await (
      await app.request(`/api/v1/projects/${project.id}`, {
        headers: { cookie: owner.cookie },
      })
    ).json()) as {
      data: {
        document: { title: string; revision: number; viewport: unknown };
      };
    };
    expect(after.data.document).toMatchObject({
      title: "只读画布",
      revision: 0,
      viewport: { x: 0, y: 0, k: 1 },
    });
  });
  it("returns validation errors as 400", async () =>
    expect(
      (
        await app.request("/api/v1/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400));
  it("rejects weak passwords and forged document fields", async () => {
    const weak = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "weak@example.com",
        password: "short",
        name: "Weak",
      }),
    });
    expect(weak.status).toBe(400);

    const { body, cookie } = await register("safe@example.com");
    const created = await app.request(
      `/api/v1/workspaces/${body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "安全画布" }),
      },
    );
    const projectId = ((await created.json()) as { data: { id: string } }).data
      .id;
    const forged = await app.request(
      `/api/v1/projects/${projectId}/mutations`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: "forged",
          projectId,
          baseRevision: 0,
          clientId: "test",
          createdAt: new Date().toISOString(),
          operations: [
            { type: "document.sync", patch: { revision: -100, id: "other" } },
          ],
        }),
      },
    );
    expect(forged.status).toBe(400);
  });
  it("round-trips extension node fields through a validated mutation", async () => {
    const { body, cookie } = await register("plugin@example.com");
    const created = await app.request(
      `/api/v1/workspaces/${body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "插件画布" }),
      },
    );
    const projectId = ((await created.json()) as { data: { id: string } }).data
      .id;
    const response = await app.request(
      `/api/v1/projects/${projectId}/mutations`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: "plugin-node",
          projectId,
          baseRevision: 0,
          clientId: "test",
          createdAt: new Date().toISOString(),
          operations: [
            {
              type: "node.upsert",
              node: {
                id: "n1",
                type: "plugin:custom",
                title: "Custom",
                position: { x: 0, y: 0 },
                width: 100,
                height: 100,
                extensionPayload: { keep: true },
              },
            },
          ],
        }),
      },
    );
    const data = (await response.json()) as {
      data: {
        project: { document: { nodes: Array<Record<string, unknown>> } };
      };
    };
    expect(data.data.project.document.nodes[0]?.extensionPayload).toEqual({
      keep: true,
    });
  });
});

describe("workspace asset API", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  async function upload(workspaceId: string, cookie: string, bytes = png) {
    return app.request(`/api/v1/workspaces/${workspaceId}/assets`, {
      method: "POST",
      headers: { cookie, "x-file-name": "../pixel.png" },
      body: bytes,
    });
  }

  it("sniffs, deduplicates, lists and downloads immutable media", async () => {
    const { body, cookie } = await register("asset@example.com");
    const workspaceId = body.data.workspace.id;
    const first = await upload(workspaceId, cookie);
    expect(first.status).toBe(201);
    const firstData = (await first.json()) as {
      data: {
        asset: { id: string; mimeType: string; originalName: string };
        deduplicated: boolean;
      };
    };
    expect(firstData.data.asset.mimeType).toBe("image/png");
    expect(firstData.data.asset.originalName).toBe("pixel.png");
    expect(firstData.data.deduplicated).toBe(false);

    const duplicate = await upload(workspaceId, cookie);
    const duplicateData = (await duplicate.json()) as typeof firstData;
    expect(duplicateData.data.asset.id).toBe(firstData.data.asset.id);
    expect(duplicateData.data.deduplicated).toBe(true);

    const listed = await app.request(
      `/api/v1/workspaces/${workspaceId}/assets`,
      {
        headers: { cookie },
      },
    );
    expect(((await listed.json()) as { data: unknown[] }).data).toHaveLength(1);
    const content = await app.request(
      `/api/v1/assets/${firstData.data.asset.id}/content`,
      { headers: { cookie } },
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(png);
  });

  it("rejects forged media and hides assets across tenants", async () => {
    const owner = await register("asset-owner@example.com");
    const uploaded = await upload(owner.body.data.workspace.id, owner.cookie);
    const data = (await uploaded.json()) as { data: { asset: { id: string } } };
    const outsider = await register("asset-outsider@example.com");
    expect(
      (
        await app.request(`/api/v1/assets/${data.data.asset.id}/content`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await upload(
          owner.body.data.workspace.id,
          owner.cookie,
          Buffer.from("not an image"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await upload(
          owner.body.data.workspace.id,
          owner.cookie,
          Buffer.alloc(1024 * 1024 + 1),
        )
      ).status,
    ).toBe(400);
  });

  it("blocks deletion while a canvas references the asset", async () => {
    const { body, cookie } = await register("asset-ref@example.com");
    const workspaceId = body.data.workspace.id;
    const uploaded = await upload(workspaceId, cookie);
    const assetId = (
      (await uploaded.json()) as { data: { asset: { id: string } } }
    ).data.asset.id;
    const created = await app.request(
      `/api/v1/workspaces/${workspaceId}/projects`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "素材引用" }),
      },
    );
    const projectId = ((await created.json()) as { data: { id: string } }).data
      .id;
    const mutate = (
      baseRevision: number,
      mutationId: string,
      operations: unknown[],
    ) =>
      app.request(`/api/v1/projects/${projectId}/mutations`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          mutationId,
          projectId,
          baseRevision,
          clientId: "asset-test",
          createdAt: new Date().toISOString(),
          operations,
        }),
      });
    expect(
      (
        await mutate(0, "add-ref", [
          {
            type: "node.upsert",
            node: {
              id: "asset-node",
              type: "image",
              title: "Pixel",
              position: { x: 0, y: 0 },
              width: 64,
              height: 64,
              assetId,
            },
          },
        ])
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/assets/${assetId}`, {
          method: "DELETE",
          headers: { cookie },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(1, "remove-ref", [
          { type: "node.remove", nodeIds: ["asset-node"] },
        ])
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/assets/${assetId}`, {
          method: "DELETE",
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
  });
});
