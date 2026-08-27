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
export class DramaRenderService {
  constructor(
    private platform: PlatformRepository,
    private drama: DramaService,
    private production: DramaProductionService,
    private repository: DramaRenderRepository,
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
}
