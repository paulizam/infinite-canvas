import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { MemoryDramaRepository } from "./drama-repository.js";
import { DramaService } from "./drama-service.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
import { MemoryDramaProductionRepository } from "./drama-production-repository.js";
import { DramaProductionService } from "./drama-production-service.js";
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const p = new MemoryPlatformRepository(),
    j = new MemoryGenerationJobRepository();
  const dramaRepository = new MemoryDramaRepository((...x) =>
    p.requireWorkspaceRole(...x),
  );
  const drama = new DramaService(p, dramaRepository);
  const jobs = new GenerationJobService(p, j);
  app = createApp({
    identity: new IdentityService(p, 60_000),
    workspaces: new WorkspaceService(p),
    projects: new ProjectService(p),
    assets: new AssetService(p, new MemoryAssetBlobStore(), 1024),
    jobs,
    jobRepository: j,
    workerToken: "worker-token-at-least-32-characters",
    workerStaleMs: 1000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "maintenance-token-at-least-32-chars",
    secureCookies: false,
    drama,
    dramaProduction: new DramaProductionService(
      p,
      drama,
      new MemoryDramaProductionRepository(
        async (userId, projectId) =>
          (await dramaRepository.get(userId, projectId))?.project || null,
        (...x) => p.requireWorkspaceRole(...x),
        (id, revision) => dramaRepository.bumpRevision(id, revision),
      ),
      jobs,
    ),
  });
});
async function setup() {
  const r = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "drama@example.com",
      password: "test-password",
      name: "Drama",
    }),
  });
  const b = (await r.json()) as any;
  return {
    workspaceId: b.data.workspace.id,
    cookie: r.headers.get("set-cookie")!.split(";")[0]!,
  };
}
const headers = (cookie: string) => ({
  cookie,
  "content-type": "application/json",
});
describe("Drama API", () => {
  it("creates an immutable script lineage, reusable entity and ordered shot with optimistic idempotent writes", async () => {
    const s = await setup();
    let r = await app.request(
      `/api/v1/workspaces/${s.workspaceId}/drama-projects`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify({ title: "第一集", sourceText: "场景一" }),
      },
    );
    expect(r.status).toBe(201);
    let d = ((await r.json()) as any).data;
    expect(d.scripts).toHaveLength(1);
    const id = d.project.id;
    const addScript = {
      expectedRevision: 0,
      mutationId: "script-mutation-001",
      content: "场景一\n场景二",
      segments: [{ title: "场景一" }, { title: "场景二" }],
      analysis: { safety: "passed" },
      reviewStatus: "reviewing",
      operation: "split",
    };
    r = await app.request(`/api/v1/drama-projects/${id}/script-versions`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify(addScript),
    });
    expect(r.status).toBe(201);
    d = ((await r.json()) as any).data.detail;
    expect(d.project.revision).toBe(1);
    expect(d.scripts.map((x: any) => x.version)).toEqual([2, 1]);
    r = await app.request(`/api/v1/drama-projects/${id}/script-versions`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify(addScript),
    });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).data.replayed).toBe(true);
    r = await app.request(`/api/v1/drama-projects/${id}/entities`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 1,
        mutationId: "entity-mutation-001",
        kind: "character",
        name: "女主",
        sortOrder: 0,
      }),
    });
    expect(r.status).toBe(201);
    r = await app.request(`/api/v1/drama-projects/${id}/shots`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 2,
        mutationId: "shot-mutation-0001",
        title: "开场",
        prompt: "夜景",
        framing: "wide",
        cameraMovement: "pan",
        durationMs: 3000,
        sortOrder: 0,
      }),
    });
    expect(r.status).toBe(201);
    d = ((await r.json()) as any).data.detail;
    expect(d.project.revision).toBe(3);
    expect(d.entities[0].name).toBe("女主");
    expect(d.shots[0]).toMatchObject({ title: "开场", currentVersion: 1 });
    const shotId = d.shots[0].id;
    r = await app.request(`/api/v1/drama-projects/${id}/generations`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 3,
        mutationId: "generation-mutation-001",
        shotId,
        capability: "video",
        logicalModelId: "video.default",
        parameters: { prompt: "夜景 wide pan" },
      }),
    });
    expect(r.status).toBe(202);
    const generation = ((await r.json()) as any).data;
    expect(generation.revision).toBe(4);
    expect(generation.state.generations[0]).toMatchObject({ shotId });
    r = await app.request(`/api/v1/drama-projects/${id}/timeline`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 4,
        mutationId: "timeline-mutation-0001",
        shotId,
        kind: "subtitle",
        textContent: "故事开始",
        startMs: 0,
        endMs: 2800,
        sortOrder: 0,
      }),
    });
    expect(r.status).toBe(201);
    r = await app.request(`/api/v1/drama-projects/${id}/reviews`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 5,
        mutationId: "review-mutation-00001",
        shotId,
        status: "approved",
        comment: "通过",
      }),
    });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).data.revision).toBe(6);
    const stale = await app.request(`/api/v1/drama-projects/${id}`, {
      method: "PATCH",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 0,
        mutationId: "stale-mutation-001",
        title: "冲突",
      }),
    });
    expect(stale.status).toBe(409);
  });
});
