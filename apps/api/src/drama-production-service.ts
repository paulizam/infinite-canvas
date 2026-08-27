import { createHash, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { GenerationJobService } from "./generation-job-service.js";
import type { DramaService } from "./drama-service.js";
import type {
  DramaProductionRepository,
  ProductionMutation,
} from "./drama-production-repository.js";
export class DramaProductionService {
  constructor(
    private platform: PlatformRepository,
    private drama: DramaService,
    private repository: DramaProductionRepository,
    private jobs: GenerationJobService,
  ) {}
  get(userId: string, id: string) {
    return this.repository.get(userId, id);
  }
  async generate(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      shotId: string;
      capability: "image" | "video";
      logicalModelId: string;
      parameters: Record<string, unknown>;
    },
  ) {
    const d = await this.context(userId, id, input.shotId);
    const created = await this.jobs.create(userId, d.project.workspaceId, {
      capability: input.capability,
      logicalModelId: input.logicalModelId,
      clientRequestId: `drama:${id}:${input.mutationId}`,
      parameters: {
        ...input.parameters,
        dramaProjectId: id,
        shotId: input.shotId,
      },
    });
    const record = {
      id: randomUUID(),
      projectId: id,
      workspaceId: d.project.workspaceId,
      shotId: input.shotId,
      generationJobId: created.job.id,
      capability: input.capability,
      selectedAssetId: null,
      selected: false,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "generation",
      record,
    });
  }
  async select(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      generationId: string;
      assetId: string;
    },
  ) {
    const d = await this.drama.get(userId, id);
    await this.asset(userId, d.project.workspaceId, input.assetId);
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "selection",
      generationId: input.generationId,
      assetId: input.assetId,
    });
  }
  async timeline(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      shotId?: string;
      kind: "dialogue" | "voice" | "bgm" | "subtitle";
      textContent?: string;
      voice?: string;
      assetId?: string;
      startMs: number;
      endMs: number;
      sortOrder: number;
    },
  ) {
    const d = await this.context(userId, id, input.shotId);
    await this.asset(userId, d.project.workspaceId, input.assetId);
    const record = {
      id: randomUUID(),
      projectId: id,
      workspaceId: d.project.workspaceId,
      shotId: input.shotId || null,
      kind: input.kind,
      textContent: input.textContent?.trim() || "",
      voice: input.voice?.trim() || "",
      assetId: input.assetId || null,
      startMs: input.startMs,
      endMs: input.endMs,
      sortOrder: input.sortOrder,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "timeline",
      record,
    });
  }
  async review(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      shotId: string;
      status: "pending" | "approved" | "changes_requested";
      comment?: string;
    },
  ) {
    const d = await this.context(userId, id, input.shotId);
    const record = {
      id: randomUUID(),
      projectId: id,
      workspaceId: d.project.workspaceId,
      shotId: input.shotId,
      status: input.status,
      comment: input.comment?.trim() || "",
      reviewerId: userId,
      createdAt: new Date().toISOString(),
    };
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "review",
      record,
    });
  }
  private async context(userId: string, id: string, shotId?: string) {
    const d = await this.drama.get(userId, id);
    if (shotId && !d.shots.some((x) => x.id === shotId))
      throw new DomainError("DRAMA_SHOT_NOT_FOUND", 404, "镜头不存在");
    return d;
  }
  private async asset(userId: string, w: string, id?: string) {
    if (!id) return;
    const a = await this.platform.getAsset(userId, id);
    if (!a || a.workspaceId !== w)
      throw new DomainError(
        "DRAMA_ASSET_INVALID",
        422,
        "引用素材不存在或不属于当前空间",
      );
  }
  private apply(
    userId: string,
    id: string,
    revision: number,
    key: string,
    m: ProductionMutation,
  ) {
    return this.repository.mutate(userId, id, revision, key, hash(m), m);
  }
}
function hash(m: ProductionMutation) {
  let stable: unknown = m;
  if ("record" in m) {
    const { id, createdAt, ...record } = m.record;
    stable = { type: m.type, record };
  }
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
