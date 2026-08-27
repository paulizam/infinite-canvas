import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { MemoryCommunityRepository } from "./community-repository.js";
import { CommunityService } from "./community-service.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
let app: ReturnType<typeof createApp>;
const maintenance = "maintenance-token-at-least-32-chars";
beforeEach(() => {
  const p = new MemoryPlatformRepository(),
    projects = new ProjectService(p),
    jobs = new MemoryGenerationJobRepository();
  const community = new CommunityService(
    p,
    projects,
    new MemoryCommunityRepository(
      (...x) => p.requireWorkspaceRole(...x),
      async (id) => {
        const u = await p.findUserById(id);
        return u ? { id: u.id, name: u.name } : null;
      },
    ),
  );
  app = createApp({
    identity: new IdentityService(p, 60_000),
    workspaces: new WorkspaceService(p),
    projects,
    assets: new AssetService(p, new MemoryAssetBlobStore(), 1024 * 1024),
    jobs: new GenerationJobService(p, jobs),
    jobRepository: jobs,
    workerToken: "worker-token-at-least-32-characters",
    workerStaleMs: 1000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: maintenance,
    secureCookies: false,
    community,
  });
});
async function register(email: string, name: string) {
  const r = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-password", name }),
  });
  const b = (await r.json()) as any;
  return {
    userId: b.data.user.id,
    workspaceId: b.data.workspace.id,
    cookie: r.headers.get("set-cookie")!.split(";")[0]!,
  };
}
const json = (cookie: string) => ({
  cookie,
  "content-type": "application/json",
});
const moderate = (id: string, decision: string, reason = "") =>
  app.request(`/internal/v1/community/works/${id}/moderate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${maintenance}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ decision, reason }),
  });
describe("Community API", () => {
  it("freezes published snapshots and governs public interactions with an audit trail", async () => {
    const author = await register("author@example.com", "作者"),
      reader = await register("reader@example.com", "读者");
    let r = await app.request(
      `/api/v1/workspaces/${author.workspaceId}/projects`,
      {
        method: "POST",
        headers: json(author.cookie),
        body: JSON.stringify({ title: "原作" }),
      },
    );
    const projectId = ((await r.json()) as any).data.id;
    r = await app.request(
      `/api/v1/workspaces/${author.workspaceId}/community/works`,
      {
        method: "POST",
        headers: json(author.cookie),
        body: JSON.stringify({
          sourceProjectId: projectId,
          title: "星海",
          description: "第一版",
          tags: [" SciFi ", "scifi"],
          visibility: "public",
        }),
      },
    );
    expect(r.status).toBe(201);
    const work = ((await r.json()) as any).data;
    expect(work.tags).toEqual(["scifi"]);
    r = await app.request(`/api/v1/community/works/${work.id}/submit`, {
      method: "POST",
      headers: json(author.cookie),
      body: JSON.stringify({
        expectedRevision: 0,
        mutationId: "community-submit-001",
      }),
    });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).data.work.status).toBe("pending");
    expect((await app.request("/api/public/v1/community/feed")).status).toBe(
      200,
    );
    expect(
      (
        (await (
          await app.request("/api/public/v1/community/feed")
        ).json()) as any
      ).data.items,
    ).toHaveLength(0);
    expect((await moderate(work.id, "approve", "合规")).status).toBe(200);
    r = await app.request("/api/public/v1/community/feed?q=星&tag=scifi");
    let feed = ((await r.json()) as any).data;
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].version.snapshot.revision).toBe(0);
    await app.request(`/api/v1/projects/${projectId}/mutations`, {
      method: "POST",
      headers: json(author.cookie),
      body: JSON.stringify({
        mutationId: "source-change",
        projectId,
        baseRevision: 0,
        clientId: "test",
        createdAt: new Date().toISOString(),
        operations: [
          { type: "document.patch", patch: { title: "源项目已改变" } },
        ],
      }),
    });
    r = await app.request(`/api/public/v1/community/works/${work.id}`);
    expect(((await r.json()) as any).data.version.snapshot.title).toBe("原作");
    r = await app.request(`/api/v1/community/works/${work.id}/like`, {
      method: "PUT",
      headers: json(reader.cookie),
      body: JSON.stringify({ value: true }),
    });
    expect(((await r.json()) as any).data.likeCount).toBe(1);
    r = await app.request(`/api/v1/community/authors/${author.userId}/follow`, {
      method: "PUT",
      headers: json(reader.cookie),
      body: JSON.stringify({ value: true }),
    });
    expect(((await r.json()) as any).data.followerCount).toBe(1);
    r = await app.request(`/api/v1/community/works/${work.id}/reports`, {
      method: "POST",
      headers: json(reader.cookie),
      body: JSON.stringify({ reasonCode: "spam", detail: "重复内容" }),
    });
    expect(r.status).toBe(201);
    await moderate(work.id, "take_down", "举报复核");
    expect(
      (
        (await (
          await app.request("/api/public/v1/community/feed")
        ).json()) as any
      ).data.items,
    ).toHaveLength(0);
    await moderate(work.id, "restore", "申诉通过");
    expect(
      (
        (await (
          await app.request("/api/public/v1/community/feed")
        ).json()) as any
      ).data.items,
    ).toHaveLength(1);
    r = await app.request(`/internal/v1/community/works/${work.id}/audit`, {
      headers: { authorization: `Bearer ${maintenance}` },
    });
    const audit = ((await r.json()) as any).data;
    expect(audit.map((x: any) => x.action)).toEqual(
      expect.arrayContaining([
        "report.created",
        "work.approve",
        "work.take_down",
        "work.restore",
      ]),
    );
  });
});
