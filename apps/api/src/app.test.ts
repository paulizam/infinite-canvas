import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { DataGovernanceService } from "./data-governance-service.js";

let app: ReturnType<typeof createApp>;
let repository: MemoryPlatformRepository;
let governance: {
  exportAccount: ReturnType<typeof vi.fn>;
  deleteAccount: ReturnType<typeof vi.fn>;
  mediaGc: ReturnType<typeof vi.fn>;
  retention: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  repository = new MemoryPlatformRepository();
  const jobRepository = new MemoryGenerationJobRepository();
  governance = {
    exportAccount: vi.fn(async () => ({ schemaVersion: 1 })),
    deleteAccount: vi.fn(async () => ({ deletedAt: new Date().toISOString() })),
    mediaGc: vi.fn(async () => ({ deleted: 0, failed: 0 })),
    retention: vi.fn(async () => ({ expiredSessions: 0 })),
  };
  app = createApp({
    identity: new IdentityService(
      repository,
      60_000,
      "test-install-token-at-least-32-characters",
    ),
    workspaces: new WorkspaceService(repository),
    projects: new ProjectService(repository),
    assets: new AssetService(
      repository,
      new MemoryAssetBlobStore(),
      1024 * 1024,
    ),
    jobs: new GenerationJobService(repository, jobRepository),
    jobRepository,
    workerToken: [
      "test-worker-token-32-characters-long",
      "previous-worker-token-32-characters",
    ],
    workerStaleMs: 120_000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "test-maintenance-token-32-characters",
    governance: governance as unknown as DataGovernanceService,
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
  it("[BAS-004] consumes the install token exactly once for the first administrator", async () => {
    expect(
      (
        (await (await app.request("/api/v1/install/status")).json()) as {
          data: { installed: boolean };
        }
      ).data.installed,
    ).toBe(false);
    const invalid = await app.request("/api/v1/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "wrong",
        email: "admin@example.com",
        password: "strong-password",
        name: "Admin",
      }),
    });
    expect(invalid.status).toBe(403);
    const installed = await app.request("/api/v1/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "test-install-token-at-least-32-characters",
        email: "admin@example.com",
        password: "strong-password",
        name: "Admin",
      }),
    });
    expect(installed.status).toBe(201);
    expect(installed.headers.get("set-cookie")).toContain("ic_session=");
    expect(
      (
        (await (await app.request("/api/v1/install/status")).json()) as {
          data: { installed: boolean };
        }
      ).data.installed,
    ).toBe(true);
    const replay = await app.request("/api/v1/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "test-install-token-at-least-32-characters",
        email: "other@example.com",
        password: "strong-password",
        name: "Other",
      }),
    });
    expect(replay.status).toBe(409);
  });
  it("protects account export/delete and maintenance governance routes", async () => {
    expect((await app.request("/api/v1/account/export")).status).toBe(401);
    const owner = await register();
    expect(
      (
        await app.request("/api/v1/account/export", {
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(200);
    const removed = await app.request("/api/v1/account", {
      method: "DELETE",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    });
    expect(removed.status).toBe(200);
    expect(governance.deleteAccount).toHaveBeenCalledWith(
      owner.body.data.user.id,
      "test-password",
      expect.any(String),
    );
    expect(
      (
        await app.request("/internal/v1/maintenance/media-gc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            olderThan: new Date().toISOString(),
            dryRun: true,
          }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/internal/v1/maintenance/media-gc", {
          method: "POST",
          headers: {
            authorization: "Bearer test-maintenance-token-32-characters",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            olderThan: new Date().toISOString(),
            dryRun: true,
          }),
        })
      ).status,
    ).toBe(200);
  });
  it("protects Prometheus metrics with the maintenance token", async () => {
    await app.request("/health");
    expect((await app.request("/internal/v1/maintenance/metrics")).status).toBe(
      401,
    );
    const response = await app.request("/internal/v1/maintenance/metrics", {
      headers: {
        authorization: "Bearer test-maintenance-token-32-characters",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("version=0.0.4");
    const body = await response.text();
    expect(body).toContain("http_requests_total");
    expect(body).toContain("generation_queue_depth");
    expect(body).toContain("worker_last_heartbeat_age_seconds");
  });
  it("accepts the bounded previous worker token during rotation", async () => {
    const response = await app.request("/internal/v1/generation/claim", {
      method: "POST",
      headers: {
        authorization: "Bearer previous-worker-token-32-characters",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: "rotation-test",
        limit: 1,
        leaseMs: 30000,
      }),
    });
    expect(response.status).toBe(200);
  });
  it("[BAS-003] registers, authenticates and logs out a session", async () => {
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
  it("[CAN-013] [COL-002] creates a project and applies an idempotent revision mutation", async () => {
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
  it("[BAS-008] prevents cross-workspace project access", async () => {
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
  it("[BAS-007] [COL-005] allows viewers to read but rejects their entire mutation batch before any patch applies", async () => {
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
  it("[BAS-005] rejects weak passwords and forged document fields", async () => {
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
  it("[CAN-014] round-trips extension node fields through a validated mutation", async () => {
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

  it("[AST-001] sniffs, deduplicates, lists and downloads immutable media", async () => {
    const { body, cookie } = await register("asset@example.com");
    const workspaceId = body.data.workspace.id;
    const first = await upload(workspaceId, cookie);
    expect(first.status).toBe(201);
    const firstData = (await first.json()) as {
      data: {
        asset: {
          id: string;
          mimeType: string;
          originalName: string;
          storageKey: string;
          lineageRootId: string;
          version: number;
          origins: Array<{ sourceType: string; sourceId: string }>;
          variants: Array<{ kind: string; mimeType: string }>;
        };
        deduplicated: boolean;
      };
    };
    expect(firstData.data.asset.mimeType).toBe("image/png");
    expect(firstData.data.asset.originalName).toBe("pixel.png");
    expect(firstData.data.asset.storageKey).toMatch(
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/,
    );
    expect(firstData.data.asset.lineageRootId).toBe(firstData.data.asset.id);
    expect(firstData.data.asset.version).toBe(1);
    expect(firstData.data.asset.origins).toEqual([
      expect.objectContaining({ sourceType: "upload" }),
    ]);
    expect(firstData.data.asset.variants).toEqual([
      expect.objectContaining({ kind: "preview", mimeType: "image/webp" }),
    ]);
    expect(firstData.data.deduplicated).toBe(false);

    const duplicate = await upload(workspaceId, cookie);
    const duplicateData = (await duplicate.json()) as typeof firstData;
    expect(duplicateData.data.asset.id).toBe(firstData.data.asset.id);
    expect(duplicateData.data.deduplicated).toBe(true);
    expect(duplicateData.data.asset.origins).toHaveLength(2);

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
    const preview = await app.request(
      `/api/v1/assets/${firstData.data.asset.id}/content?variant=preview`,
      { headers: { cookie } },
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/webp");
    expect(
      Buffer.from(await preview.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe("RIFF");
  });

  it("[AST-004] rejects forged media and hides assets across tenants", async () => {
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

  it("[AST-006] blocks deletion while a canvas references the asset", async () => {
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

  it("[COL-007] creates immutable checkpoints and restores them as a new revision", async () => {
    const { body, cookie } = await register("checkpoint@example.com");
    const created = await app.request(
      `/api/v1/workspaces/${body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "初始画布" }),
      },
    );
    const project = ((await created.json()) as { data: { id: string } }).data;
    const checkpointResponse = await app.request(
      `/api/v1/projects/${project.id}/checkpoints`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "第一稿", description: "不可变基线" }),
      },
    );
    expect(checkpointResponse.status).toBe(201);
    const checkpoint = (
      (await checkpointResponse.json()) as {
        data: {
          id: string;
          sourceRevision: number;
          snapshot: { title: string };
        };
      }
    ).data;
    expect(checkpoint).toMatchObject({
      sourceRevision: 0,
      snapshot: { title: "初始画布" },
    });
    const viewer = await register(
      "checkpoint-viewer@example.com",
      "版本审阅者",
    );
    await repository.createWorkspace(
      {
        id: body.data.workspace.id,
        name: "共享版本空间",
        createdAt: new Date().toISOString(),
      },
      {
        workspaceId: body.data.workspace.id,
        userId: viewer.body.data.user.id,
        role: "viewer",
      },
    );
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}/checkpoints`, {
          headers: { cookie: viewer.cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/projects/${project.id}/checkpoints/${checkpoint.id}`,
          { headers: { cookie: viewer.cookie } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}/checkpoints`, {
          method: "POST",
          headers: {
            cookie: viewer.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: "越权版本" }),
        })
      ).status,
    ).toBe(403);

    await app.request(`/api/v1/projects/${project.id}/mutations`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        mutationId: "after-checkpoint",
        projectId: project.id,
        baseRevision: 0,
        clientId: "checkpoint-test",
        createdAt: new Date().toISOString(),
        operations: [{ type: "document.patch", patch: { title: "第二稿" } }],
      }),
    });
    const restoredResponse = await app.request(
      `/api/v1/projects/${project.id}/checkpoints/${checkpoint.id}/restore`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1 }),
      },
    );
    const restored = (
      (await restoredResponse.json()) as {
        data: { document: { revision: number; title: string } };
      }
    ).data;
    expect(restored.document).toMatchObject({ revision: 2, title: "初始画布" });
    expect(
      (
        await app.request(
          `/api/v1/projects/${project.id}/checkpoints/${checkpoint.id}/restore`,
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ expectedRevision: 1 }),
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(
          `/api/v1/projects/${project.id}/checkpoints/${checkpoint.id}/restore`,
          {
            method: "POST",
            headers: {
              cookie: viewer.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({ expectedRevision: 2 }),
          },
        )
      ).status,
    ).toBe(403);
    const unchanged = await app.request(
      `/api/v1/projects/${project.id}/checkpoints/${checkpoint.id}`,
      { headers: { cookie } },
    );
    expect(
      (
        (await unchanged.json()) as {
          data: { sourceRevision: number; snapshot: { title: string } };
        }
      ).data,
    ).toMatchObject({
      sourceRevision: 0,
      snapshot: { title: "初始画布" },
    });
  });
});
