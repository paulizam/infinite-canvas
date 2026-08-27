import { DomainError, type WorkspaceRole } from "./domain.js";
export type ShotGeneration = {
  id: string;
  projectId: string;
  workspaceId: string;
  shotId: string;
  generationJobId: string;
  capability: "image" | "video";
  selectedAssetId: string | null;
  selected: boolean;
  createdBy: string;
  createdAt: string;
};
export type TimelineItem = {
  id: string;
  projectId: string;
  workspaceId: string;
  shotId: string | null;
  kind: "dialogue" | "voice" | "bgm" | "subtitle";
  textContent: string;
  voice: string;
  assetId: string | null;
  startMs: number;
  endMs: number;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
};
export type ShotReview = {
  id: string;
  projectId: string;
  workspaceId: string;
  shotId: string;
  status: "pending" | "approved" | "changes_requested";
  comment: string;
  reviewerId: string;
  createdAt: string;
};
export type ProductionMutation =
  | { type: "generation"; record: ShotGeneration }
  | { type: "timeline"; record: TimelineItem }
  | { type: "review"; record: ShotReview }
  | { type: "selection"; generationId: string; assetId: string };
export type ProductionState = {
  generations: ShotGeneration[];
  timeline: TimelineItem[];
  reviews: ShotReview[];
};
export interface DramaProductionRepository {
  get(userId: string, projectId: string): Promise<ProductionState>;
  mutate(
    userId: string,
    projectId: string,
    expectedRevision: number,
    mutationId: string,
    requestHash: string,
    mutation: ProductionMutation,
  ): Promise<{ revision: number; state: ProductionState; replayed: boolean }>;
}
export class MemoryDramaProductionRepository implements DramaProductionRepository {
  private generations: ShotGeneration[] = [];
  private timeline: TimelineItem[] = [];
  private reviews: ShotReview[] = [];
  private revisions = new Map<string, number>();
  private mutations = new Map<string, string>();
  constructor(
    private projectOf: (
      userId: string,
      projectId: string,
    ) => Promise<{ workspaceId: string; revision: number } | null>,
    private requireRole: (
      userId: string,
      workspaceId: string,
      minimum: WorkspaceRole,
    ) => Promise<void>,
    private bumpProject?: (projectId: string, expectedRevision: number) => void,
  ) {}
  async get(userId: string, id: string) {
    const p = await this.projectOf(userId, id);
    if (!p) throw missing();
    await this.requireRole(userId, p.workspaceId, "viewer");
    return this.state(id);
  }
  async mutate(
    userId: string,
    id: string,
    expected: number,
    key: string,
    hash: string,
    m: ProductionMutation,
  ) {
    const p = await this.projectOf(userId, id);
    if (!p) throw missing();
    await this.requireRole(userId, p.workspaceId, "editor");
    const mk = `${id}:${key}`,
      old = this.mutations.get(mk);
    if (old) {
      if (old !== hash)
        throw new DomainError(
          "DRAMA_IDEMPOTENCY_CONFLICT",
          409,
          "幂等键内容漂移",
        );
      return {
        revision: this.revisions.get(id) || expected,
        state: this.state(id),
        replayed: true,
      };
    }
    const current = this.revisions.get(id) ?? p.revision;
    if (current !== expected)
      throw new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
    if (m.type === "generation") this.generations.push(m.record);
    else if (m.type === "timeline") this.timeline.push(m.record);
    else if (m.type === "review") this.reviews.push(m.record);
    else {
      const target = this.generations.find(
        (x) => x.id === m.generationId && x.projectId === id,
      );
      if (!target)
        throw new DomainError(
          "DRAMA_GENERATION_NOT_FOUND",
          404,
          "镜头生成记录不存在",
        );
      for (const x of this.generations)
        if (x.shotId === target.shotId) x.selected = false;
      target.selected = true;
      target.selectedAssetId = m.assetId;
    }
    this.revisions.set(id, expected + 1);
    this.bumpProject?.(id, expected);
    this.mutations.set(mk, hash);
    return { revision: expected + 1, state: this.state(id), replayed: false };
  }
  private state(id: string) {
    return {
      generations: this.generations.filter((x) => x.projectId === id),
      timeline: this.timeline
        .filter((x) => x.projectId === id)
        .sort((a, b) => a.startMs - b.startMs || a.sortOrder - b.sortOrder),
      reviews: this.reviews
        .filter((x) => x.projectId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }
}
function missing() {
  return new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
}
