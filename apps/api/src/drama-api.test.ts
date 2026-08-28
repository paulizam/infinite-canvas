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
import { MemoryDramaRenderRepository } from "./drama-render-repository.js";
import { DramaRenderService } from "./drama-render-service.js";
import { DramaInteropService } from "./drama-interop-service.js";
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const p = new MemoryPlatformRepository(),
    j = new MemoryGenerationJobRepository();
  const dramaRepository = new MemoryDramaRepository((...x) =>
    p.requireWorkspaceRole(...x),
  );
  const jobs = new GenerationJobService(p, j);
  const drama = new DramaService(p, dramaRepository, jobs);
  const assetService = new AssetService(
    p,
    new MemoryAssetBlobStore(),
    1024 * 1024,
  );
  const production = new DramaProductionService(
    p,
    drama,
    new MemoryDramaProductionRepository(
      async (userId, projectId) =>
        (await dramaRepository.get(userId, projectId))?.project || null,
      (...x) => p.requireWorkspaceRole(...x),
      (id, revision) => dramaRepository.bumpRevision(id, revision),
    ),
    jobs,
  );
  const render = new DramaRenderService(
    p,
    drama,
    production,
    new MemoryDramaRenderRepository(
      async (userId, projectId) =>
        (await dramaRepository.get(userId, projectId))?.project || null,
      (...x) => p.requireWorkspaceRole(...x),
      (id, revision) => dramaRepository.bumpRevision(id, revision),
    ),
    assetService,
  );
  const projectService = new ProjectService(p);
  app = createApp({
    identity: new IdentityService(p, 60_000),
    workspaces: new WorkspaceService(p),
    projects: projectService,
    assets: assetService,
    jobs,
    jobRepository: j,
    workerToken: "worker-token-at-least-32-characters",
    workerStaleMs: 1000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "maintenance-token-at-least-32-chars",
    secureCookies: false,
    drama,
    dramaProduction: production,
    dramaRender: render,
    dramaInterop: new DramaInteropService(
      p,
      projectService,
      drama,
      production,
      render,
    ),
  });
});

describe("Drama script analysis", () => {
  it("[DRM-002] runs analysis as a durable text job and applies validated output as an immutable version", async () => {
    const s = await setup();
    let r = await app.request(
      `/api/v1/workspaces/${s.workspaceId}/drama-projects`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify({
          title: "分析",
          sourceText: "雨夜，林夏进入车站。",
        }),
      },
    );
    const created = ((await r.json()) as any).data;
    const id = created.project.id,
      scriptVersionId = created.scripts[0].id;
    const request = {
      expectedRevision: 0,
      mutationId: "analysis-create-001",
      scriptVersionId,
      logicalModelId: "text.default",
    };
    r = await app.request(`/api/v1/drama-projects/${id}/script-analyses`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify(request),
    });
    expect(r.status).toBe(202);
    const first = ((await r.json()) as any).data;
    expect(first.job).toMatchObject({
      capability: "text",
      input: {
        dramaOperation: "script_analysis",
        dramaProjectId: id,
        scriptVersionId,
      },
    });
    r = await app.request(`/api/v1/drama-projects/${id}/script-analyses`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify(request),
    });
    expect(((await r.json()) as any).data.replayed).toBe(true);
    r = await app.request(
      `/api/v1/drama-projects/${id}/script-analyses/apply`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify({
          expectedRevision: 0,
          mutationId: "analysis-apply-001",
          jobId: first.job.id,
        }),
      },
    );
    expect(r.status).toBe(409);
    r = await app.request("/internal/v1/generation/claim", {
      method: "POST",
      headers: {
        authorization: "Bearer worker-token-at-least-32-characters",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: "analysis-worker",
        limit: 1,
        leaseMs: 90_000,
      }),
    });
    expect(((await r.json()) as any).data[0].id).toBe(first.job.id);
    const output = JSON.stringify({
      summary: "林夏在雨夜进入车站",
      safety: { status: "passed", issues: [] },
      segments: [
        {
          title: "车站",
          content: "雨夜，林夏进入车站。",
          characters: ["林夏"],
          scene: "车站",
        },
      ],
    });
    for (const [phase, patch] of [
      ["submitting", {}],
      ["submitted", {}],
      ["result_ready", { result: { text: output } }],
      ["persisting", {}],
      ["succeeded", {}],
    ] as const) {
      r = await app.request(
        `/internal/v1/generation/jobs/${first.job.id}/transition`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer worker-token-at-least-32-characters",
            "content-type": "application/json",
          },
          body: JSON.stringify({ workerId: "analysis-worker", phase, patch }),
        },
      );
      expect(r.status).toBe(200);
    }
    r = await app.request(`/api/v1/drama-projects/${id}/script-analyses`, {
      headers: { cookie: s.cookie },
    });
    expect(((await r.json()) as any).data[0].status).toBe("succeeded");
    const apply = {
      expectedRevision: 0,
      mutationId: "analysis-apply-001",
      jobId: first.job.id,
    };
    r = await app.request(
      `/api/v1/drama-projects/${id}/script-analyses/apply`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify(apply),
      },
    );
    expect(r.status).toBe(201);
    const detail = ((await r.json()) as any).data.detail;
    expect(detail.scripts[0]).toMatchObject({
      version: 2,
      operation: "analysis",
      reviewStatus: "reviewing",
      analysis: { sourceJobId: first.job.id },
    });
    expect(detail.scripts[0].segments).toHaveLength(1);
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
  it("transfers a workspace asset from Drama to Canvas and back with revision and drift guards", async () => {
    const s = await setup();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    let r = await app.request(`/api/v1/workspaces/${s.workspaceId}/assets`, {
      method: "POST",
      headers: {
        cookie: s.cookie,
        "x-file-name": "ref.png",
        "content-type": "application/octet-stream",
      },
      body: png,
    });
    expect(r.status).toBe(201);
    const assetId = ((await r.json()) as any).data.asset.id;
    r = await app.request(
      `/api/v1/workspaces/${s.workspaceId}/drama-projects`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify({ title: "互通", sourceAssetId: assetId }),
      },
    );
    const dramaId = ((await r.json()) as any).data.project.id;
    r = await app.request(`/api/v1/workspaces/${s.workspaceId}/projects`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({ title: "互通画布" }),
    });
    const canvasId = ((await r.json()) as any).data.id;
    const toCanvas = {
      canvasProjectId: canvasId,
      assetId,
      expectedCanvasRevision: 0,
      mutationId: "transfer-to-canvas-001",
      position: { x: 10, y: 20 },
    };
    r = await app.request(
      `/api/v1/drama-projects/${dramaId}/transfers/to-canvas`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify(toCanvas),
      },
    );
    expect(r.status).toBe(201);
    const node = ((await r.json()) as any).data.node;
    expect(node).toMatchObject({
      type: "image",
      metadata: { assetId, dramaProjectId: dramaId },
    });
    r = await app.request(
      `/api/v1/drama-projects/${dramaId}/transfers/to-canvas`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify(toCanvas),
      },
    );
    expect(((await r.json()) as any).data.mutation.replayed).toBe(true);
    r = await app.request(
      `/api/v1/drama-projects/${dramaId}/transfers/to-canvas`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify({ ...toCanvas, title: "漂移节点" }),
      },
    );
    expect(r.status).toBe(409);
    const fromCanvas = {
      canvasProjectId: canvasId,
      nodeId: node.id,
      expectedDramaRevision: 0,
      mutationId: "transfer-from-canvas-001",
      target: {
        type: "entity",
        kind: "character",
        name: "参考角色",
        sortOrder: 0,
      },
    };
    r = await app.request(
      `/api/v1/drama-projects/${dramaId}/transfers/from-canvas`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify(fromCanvas),
      },
    );
    expect(r.status).toBe(201);
    expect(
      ((await r.json()) as any).data.detail.entities[0].referenceAssetId,
    ).toBe(assetId);
    r = await app.request(
      `/api/v1/drama-projects/${dramaId}/transfers/from-canvas`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify(fromCanvas),
      },
    );
    expect(((await r.json()) as any).data.replayed).toBe(true);
    r = await app.request(
      `/api/v1/drama-projects/${dramaId}/transfers/from-canvas`,
      {
        method: "POST",
        headers: headers(s.cookie),
        body: JSON.stringify({
          ...fromCanvas,
          target: { ...fromCanvas.target, name: "漂移" },
        }),
      },
    );
    expect(r.status).toBe(409);
  });
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
    r = await app.request(`/api/v1/drama-projects/${id}/renders`, {
      method: "POST",
      headers: headers(s.cookie),
      body: JSON.stringify({
        expectedRevision: 6,
        mutationId: "render-mutation-00001",
        kind: "jianying",
        settings: { version: "6" },
      }),
    });
    expect(r.status).toBe(202);
    const renderId = ((await r.json()) as any).data.job.id;
    r = await app.request("/internal/v1/drama-render/claim", {
      method: "POST",
      headers: {
        authorization: "Bearer worker-token-at-least-32-characters",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: "render-worker",
        limit: 1,
        leaseMs: 90_000,
      }),
    });
    const claimedRender = ((await r.json()) as any).data[0];
    expect(claimedRender.id).toBe(renderId);
    expect(claimedRender.input.materials).toEqual([]);
    r = await app.request(
      `/internal/v1/drama-render/jobs/${renderId}/transition`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer worker-token-at-least-32-characters",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workerId: "render-worker",
          status: "succeeded",
          patch: {
            progress: 100,
            outputAssetId: "00000000-0000-4000-8000-000000000001",
          },
        }),
      },
    );
    expect(r.status).toBe(200);
    r = await app.request(`/api/v1/drama-projects/${id}/renders`, {
      headers: { cookie: s.cookie },
    });
    expect(((await r.json()) as any).data.versions).toHaveLength(1);
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
