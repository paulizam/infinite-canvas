import { DomainError, type WorkspaceRole } from "./domain.js";
export type RenderKind = "ffmpeg" | "jianying";
export type RenderStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DramaRenderJob = {
  id: string;
  projectId: string;
  workspaceId: string;
  ownerId: string;
  kind: RenderKind;
  status: RenderStatus;
  progress: number;
  attempt: number;
  retryOf: string | null;
  input: {
    assetIds: string[];
    materials?: Array<{
      assetId: string;
      kind: "image" | "video" | "audio";
      shotId: string | null;
      startMs: number;
      durationMs: number;
      sortOrder: number;
    }>;
    timeline: unknown[];
    settings: Record<string, unknown>;
  };
  outputAssetId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  workerId: string | null;
  leaseUntil: string | null;
  mutationId: string;
  createdAt: string;
  updatedAt: string;
};
export type DramaRenderVersion = {
  id: string;
  projectId: string;
  workspaceId: string;
  renderJobId: string;
  version: number;
  kind: RenderKind;
  assetId: string;
  createdBy: string;
  createdAt: string;
};
export interface DramaRenderRepository {
  list(
    userId: string,
    projectId: string,
  ): Promise<{ jobs: DramaRenderJob[]; versions: DramaRenderVersion[] }>;
  create(
    userId: string,
    expectedRevision: number,
    hash: string,
    job: DramaRenderJob,
  ): Promise<{ job: DramaRenderJob; replayed: boolean }>;
  retry(
    userId: string,
    jobId: string,
    newId: string,
    mutationId: string,
    now: string,
  ): Promise<DramaRenderJob>;
  getLeased(
    workerId: string,
    jobId: string,
    now: string,
  ): Promise<DramaRenderJob | null>;
  claim(
    workerId: string,
    limit: number,
    now: string,
    leaseUntil: string,
  ): Promise<DramaRenderJob[]>;
  heartbeat(
    workerId: string,
    ids: string[],
    leaseUntil: string,
  ): Promise<number>;
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
    now: string,
  ): Promise<DramaRenderJob>;
}
export class MemoryDramaRenderRepository implements DramaRenderRepository {
  private jobs = new Map<string, DramaRenderJob>();
  private versions: DramaRenderVersion[] = [];
  constructor(
    private projectOf: (
      userId: string,
      id: string,
    ) => Promise<{ workspaceId: string; revision: number } | null>,
    private role: (
      userId: string,
      w: string,
      r: WorkspaceRole,
    ) => Promise<void>,
    private bump: (id: string, revision: number) => void,
  ) {}
  async list(userId: string, id: string) {
    const p = await this.projectOf(userId, id);
    if (!p) throw missing();
    await this.role(userId, p.workspaceId, "viewer");
    return {
      jobs: [...this.jobs.values()].filter((x) => x.projectId === id),
      versions: this.versions.filter((x) => x.projectId === id),
    };
  }
  async create(
    userId: string,
    expected: number,
    hash: string,
    job: DramaRenderJob,
  ) {
    const p = await this.projectOf(userId, job.projectId);
    if (!p) throw missing();
    await this.role(userId, p.workspaceId, "editor");
    const old = [...this.jobs.values()].find(
      (x) => x.projectId === job.projectId && x.mutationId === job.mutationId,
    );
    if (old) {
      if ((old.input as any).__hash !== hash)
        throw new DomainError(
          "DRAMA_IDEMPOTENCY_CONFLICT",
          409,
          "幂等键内容漂移",
        );
      return { job: clean(old), replayed: true };
    }
    if (p.revision !== expected) throw revision();
    job.input = { ...job.input, __hash: hash } as any;
    this.jobs.set(job.id, job);
    this.bump(job.projectId, expected);
    return { job: clean(job), replayed: false };
  }
  async retry(
    userId: string,
    id: string,
    newId: string,
    mutationId: string,
    now: string,
  ) {
    const x = this.jobs.get(id);
    if (!x)
      throw new DomainError("DRAMA_RENDER_NOT_FOUND", 404, "渲染任务不存在");
    await this.role(userId, x.workspaceId, "editor");
    if (!["failed", "cancelled"].includes(x.status))
      throw new DomainError(
        "DRAMA_RENDER_NOT_RETRYABLE",
        409,
        "仅失败或取消任务可重试",
      );
    const n = {
      ...x,
      id: newId,
      status: "queued" as const,
      progress: 0,
      attempt: x.attempt + 1,
      retryOf: x.id,
      mutationId,
      workerId: null,
      leaseUntil: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(n.id, n);
    return clean(n);
  }
  async claim(
    workerId: string,
    limit: number,
    now: string,
    leaseUntil: string,
  ) {
    const a = [...this.jobs.values()]
      .filter(
        (x) =>
          x.status === "queued" ||
          (x.status === "running" && !!x.leaseUntil && x.leaseUntil < now),
      )
      .slice(0, limit);
    for (const x of a)
      Object.assign(x, {
        status: "running",
        workerId,
        leaseUntil,
        updatedAt: now,
      });
    return a.map(clean);
  }
  async getLeased(workerId: string, id: string, now: string) {
    const x = this.jobs.get(id);
    return x?.workerId === workerId &&
      x.status === "running" &&
      !!x.leaseUntil &&
      x.leaseUntil > now
      ? clean(x)
      : null;
  }
  async heartbeat(w: string, ids: string[], lease: string) {
    let n = 0;
    for (const id of ids) {
      const x = this.jobs.get(id);
      if (x?.workerId === w && x.status === "running") {
        x.leaseUntil = lease;
        n++;
      }
    }
    return n;
  }
  async transition(
    w: string,
    id: string,
    status: RenderStatus,
    p: any,
    now: string,
  ) {
    const x = this.jobs.get(id);
    if (!x || x.workerId !== w || x.status !== "running")
      throw new DomainError("DRAMA_RENDER_LEASE_LOST", 409, "渲染租约已失效");
    Object.assign(x, p, {
      status,
      updatedAt: now,
      ...(["succeeded", "failed", "cancelled"].includes(status)
        ? { leaseUntil: null, workerId: null }
        : {}),
    });
    if (status === "succeeded" && p.outputAssetId)
      this.versions.push({
        id: crypto.randomUUID(),
        projectId: x.projectId,
        workspaceId: x.workspaceId,
        renderJobId: x.id,
        version:
          this.versions.filter(
            (v) => v.projectId === x.projectId && v.kind === x.kind,
          ).length + 1,
        kind: x.kind,
        assetId: p.outputAssetId,
        createdBy: x.ownerId,
        createdAt: now,
      });
    return clean(x);
  }
}
const clean = (x: DramaRenderJob): DramaRenderJob => ({
  ...x,
  input: Object.fromEntries(
    Object.entries(x.input).filter(([k]) => k !== "__hash"),
  ) as DramaRenderJob["input"],
});
const missing = () => new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
const revision = () =>
  new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
