import { createHash, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { DramaService } from "./drama-service.js";
import type { DramaProductionService } from "./drama-production-service.js";
import type {
  DramaRenderJob,
  DramaRenderRepository,
  RenderKind,
  RenderStatus,
} from "./drama-render-repository.js";
import type { AssetService } from "./asset-service.js";
export class DramaRenderService {
  constructor(
    private platform: PlatformRepository,
    private drama: DramaService,
    private production: DramaProductionService,
    private repository: DramaRenderRepository,
    private assets: AssetService,
  ) {}
  list(userId: string, id: string) {
    return this.repository.list(userId, id);
  }
  async create(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      kind: RenderKind;
      settings: Record<string, unknown>;
    },
  ) {
    const [d, p] = await Promise.all([
      this.drama.get(userId, id),
      this.production.get(userId, id),
    ]);
    await this.platform.requireWorkspaceRole(
      userId,
      d.project.workspaceId,
      "editor",
    );
    if (d.project.revision !== input.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
    const assetIds = [
      ...new Set([
        ...p.generations
          .filter((x) => x.selected && x.selectedAssetId)
          .map((x) => x.selectedAssetId!),
        ...p.timeline.filter((x) => x.assetId).map((x) => x.assetId!),
      ]),
    ];
    if (input.kind === "ffmpeg" && !assetIds.length)
      throw new DomainError(
        "DRAMA_RENDER_INPUT_EMPTY",
        422,
        "FFmpeg 合成至少需要一个已选择媒体素材",
      );
    const now = new Date().toISOString();
    const job: DramaRenderJob = {
      id: randomUUID(),
      projectId: id,
      workspaceId: d.project.workspaceId,
      ownerId: userId,
      kind: input.kind,
      status: "queued",
      progress: 0,
      attempt: 1,
      retryOf: null,
      input: { assetIds, timeline: p.timeline, settings: input.settings },
      outputAssetId: null,
      errorCode: null,
      errorMessage: null,
      workerId: null,
      leaseUntil: null,
      mutationId: input.mutationId,
      createdAt: now,
      updatedAt: now,
    };
    const hash = createHash("sha256")
      .update(JSON.stringify({ kind: input.kind, input: job.input }))
      .digest("hex");
    return this.repository.create(userId, input.expectedRevision, hash, job);
  }
  retry(userId: string, id: string, mutationId: string) {
    return this.repository.retry(
      userId,
      id,
      randomUUID(),
      mutationId,
      new Date().toISOString(),
    );
  }
  claim(workerId: string, limit: number, leaseMs: number) {
    const now = new Date();
    return this.repository.claim(
      workerId,
      limit,
      now.toISOString(),
      new Date(
        now.getTime() + Math.max(30_000, Math.min(300_000, leaseMs)),
      ).toISOString(),
    );
  }
  heartbeat(workerId: string, ids: string[]) {
    return this.repository.heartbeat(
      workerId,
      ids,
      new Date(Date.now() + 90_000).toISOString(),
    );
  }
  transition(
    workerId: string,
    id: string,
    status: RenderStatus,
    patch: {
      progress?: number;
      outputAssetId?: string;
      errorCode?: string;
      errorMessage?: string;
    },
  ) {
    return this.repository.transition(
      workerId,
      id,
      status,
      patch,
      new Date().toISOString(),
    );
  }
  async readInput(workerId: string, id: string, assetId: string) {
    const job = await this.leased(workerId, id);
    if (!job.input.assetIds.includes(assetId))
      throw new DomainError(
        "DRAMA_RENDER_ASSET_FORBIDDEN",
        403,
        "素材不属于该渲染任务",
      );
    const value = await this.assets.readBytes(job.ownerId, assetId);
    if (value.asset.workspaceId !== job.workspaceId)
      throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    return value;
  }
  async persistOutput(
    workerId: string,
    id: string,
    bytes: Buffer,
    name: string,
  ) {
    const job = await this.leased(workerId, id);
    const result = await this.assets.upload(job.ownerId, job.workspaceId, {
      bytes,
      originalName: name,
      parentAssetIds: job.input.assetIds,
      origin: {
        sourceType: "drama_render",
        sourceId: job.id,
        metadata: {
          projectId: job.projectId,
          kind: job.kind,
          attempt: job.attempt,
        },
      },
    });
    if (job.kind === "ffmpeg" && result.asset.kind !== "video")
      throw new DomainError(
        "DRAMA_RENDER_OUTPUT_INVALID",
        422,
        "FFmpeg 产物必须是视频",
      );
    if (job.kind === "jianying" && result.asset.kind !== "file")
      throw new DomainError(
        "DRAMA_RENDER_OUTPUT_INVALID",
        422,
        "剪映产物必须是 ZIP",
      );
    return result;
  }
  private async leased(workerId: string, id: string) {
    const job = await this.repository.getLeased(
      workerId,
      id,
      new Date().toISOString(),
    );
    if (!job)
      throw new DomainError("DRAMA_RENDER_LEASE_LOST", 409, "渲染租约已失效");
    return job;
  }
}
