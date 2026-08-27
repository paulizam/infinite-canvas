import { DomainError, type WorkspaceRole } from "./domain.js";

export type DramaProject = {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  sourceText: string;
  sourceAssetId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type DramaScriptVersion = {
  id: string;
  projectId: string;
  workspaceId: string;
  version: number;
  content: string;
  segments: unknown[];
  analysis: Record<string, unknown>;
  reviewStatus: "draft" | "reviewing" | "approved" | "rejected";
  operation: "import" | "revision" | "split" | "merge" | "analysis";
  createdBy: string;
  createdAt: string;
};
export type DramaEntity = {
  id: string;
  projectId: string;
  workspaceId: string;
  kind: "character" | "scene" | "prop";
  name: string;
  description: string;
  prompt: string;
  referenceAssetId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
export type DramaShot = {
  id: string;
  projectId: string;
  workspaceId: string;
  title: string;
  prompt: string;
  framing: string;
  cameraMovement: string;
  durationMs: number;
  sortOrder: number;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};
export type DramaDetail = {
  project: DramaProject;
  scripts: DramaScriptVersion[];
  entities: DramaEntity[];
  shots: DramaShot[];
};
export type DramaMutation =
  | {
      type: "project";
      title: string;
      sourceText: string;
      sourceAssetId: string | null;
    }
  | { type: "script"; record: DramaScriptVersion }
  | { type: "entity"; record: DramaEntity }
  | { type: "shot"; record: DramaShot };
export interface DramaRepository {
  list(userId: string, workspaceId: string): Promise<DramaProject[]>;
  get(userId: string, projectId: string): Promise<DramaDetail | null>;
  create(
    userId: string,
    project: DramaProject,
    script: DramaScriptVersion | null,
  ): Promise<DramaDetail>;
  mutate(
    userId: string,
    projectId: string,
    expectedRevision: number,
    mutationId: string,
    requestHash: string,
    mutation: DramaMutation,
  ): Promise<{ detail: DramaDetail; replayed: boolean }>;
}

export class MemoryDramaRepository implements DramaRepository {
  private projects = new Map<string, DramaProject>();
  private scripts: DramaScriptVersion[] = [];
  private entities: DramaEntity[] = [];
  private shots: DramaShot[] = [];
  private mutations = new Map<string, { hash: string; revision: number }>();
  constructor(
    private requireRole: (
      userId: string,
      workspaceId: string,
      minimum: WorkspaceRole,
    ) => Promise<void>,
  ) {}
  async list(userId: string, workspaceId: string) {
    await this.requireRole(userId, workspaceId, "viewer");
    return [...this.projects.values()]
      .filter((x) => x.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(userId: string, id: string) {
    const p = this.projects.get(id);
    if (!p) return null;
    await this.requireRole(userId, p.workspaceId, "viewer");
    return this.detail(p);
  }
  async create(userId: string, p: DramaProject, s: DramaScriptVersion | null) {
    await this.requireRole(userId, p.workspaceId, "editor");
    this.projects.set(p.id, p);
    if (s) this.scripts.push(s);
    return this.detail(p);
  }
  async mutate(
    userId: string,
    id: string,
    expected: number,
    mutationId: string,
    hash: string,
    m: DramaMutation,
  ) {
    const p = this.projects.get(id);
    if (!p) throw notFound();
    await this.requireRole(userId, p.workspaceId, "editor");
    const key = `${id}:${mutationId}`,
      prior = this.mutations.get(key);
    if (prior) {
      if (prior.hash !== hash)
        throw conflict("DRAMA_IDEMPOTENCY_CONFLICT", "幂等键内容漂移");
      return { detail: this.detail(this.projects.get(id)!), replayed: true };
    }
    if (p.revision !== expected)
      throw conflict("REVISION_CONFLICT", "短剧项目版本冲突");
    const now = new Date().toISOString();
    if (m.type === "project")
      Object.assign(p, {
        title: m.title,
        sourceText: m.sourceText,
        sourceAssetId: m.sourceAssetId,
      });
    else if (m.type === "script") this.scripts.push(m.record);
    else if (m.type === "entity") this.entities.push(m.record);
    else this.shots.push(m.record);
    p.revision++;
    p.updatedAt = now;
    this.mutations.set(key, { hash, revision: p.revision });
    return { detail: this.detail(p), replayed: false };
  }
  private detail(p: DramaProject): DramaDetail {
    return {
      project: { ...p },
      scripts: this.scripts
        .filter((x) => x.projectId === p.id)
        .sort((a, b) => b.version - a.version),
      entities: this.entities.filter((x) => x.projectId === p.id).sort(order),
      shots: this.shots.filter((x) => x.projectId === p.id).sort(order),
    };
  }
}
function order(a: { sortOrder: number }, b: { sortOrder: number }) {
  return a.sortOrder - b.sortOrder;
}
function notFound() {
  return new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
}
function conflict(code: string, message: string) {
  return new DomainError(code, 409, message);
}
