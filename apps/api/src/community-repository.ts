import { DomainError, type WorkspaceRole } from "./domain.js";
export type CommunityStatus =
  "draft" | "pending" | "published" | "rejected" | "taken_down";
export type CommunityWork = {
  id: string;
  workspaceId: string;
  ownerId: string;
  sourceProjectId: string | null;
  title: string;
  description: string;
  coverAssetId: string | null;
  tags: string[];
  visibility: "public" | "unlisted" | "private";
  status: CommunityStatus;
  revision: number;
  draftSnapshot: Record<string, unknown>;
  moderationReason: string;
  createdAt: string;
  updatedAt: string;
};
export type CommunityVersion = {
  id: string;
  workId: string;
  workspaceId: string;
  version: number;
  snapshot: Record<string, unknown>;
  reviewedBy: string | null;
  publishedAt: string;
};
export type CommunityView = CommunityWork & {
  author: { id: string; name: string };
  likeCount: number;
  liked?: boolean;
  followerCount: number;
  version: CommunityVersion | null;
};
export interface CommunityRepository {
  listOwned(userId: string, workspaceId: string): Promise<CommunityWork[]>;
  create(userId: string, work: CommunityWork): Promise<CommunityWork>;
  mutate(
    userId: string,
    id: string,
    expected: number,
    key: string,
    hash: string,
    patch: Partial<
      Pick<
        CommunityWork,
        | "title"
        | "description"
        | "coverAssetId"
        | "tags"
        | "visibility"
        | "draftSnapshot"
      >
    >,
    submit: boolean,
  ): Promise<{ work: CommunityWork; replayed: boolean }>;
  feed(input: {
    query?: string;
    tag?: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: CommunityView[]; nextCursor: string | null }>;
  detail(id: string, userId?: string): Promise<CommunityView | null>;
  author(
    authorId: string,
    userId?: string,
  ): Promise<{
    author: { id: string; name: string };
    works: CommunityView[];
    followerCount: number;
    following: boolean;
  }>;
  like(
    userId: string,
    id: string,
    value: boolean,
  ): Promise<{ liked: boolean; likeCount: number }>;
  follow(
    userId: string,
    authorId: string,
    value: boolean,
  ): Promise<{ following: boolean; followerCount: number }>;
  report(
    userId: string,
    id: string,
    reasonCode: string,
    detail: string,
    now: string,
  ): Promise<void>;
  moderate(
    id: string,
    decision: "approve" | "reject" | "take_down" | "restore",
    reason: string,
    requestId: string,
    now: string,
  ): Promise<CommunityWork>;
  audit(id: string): Promise<unknown[]>;
}
export class MemoryCommunityRepository implements CommunityRepository {
  private works = new Map<string, CommunityWork>();
  private versions: CommunityVersion[] = [];
  private mutations = new Map<string, string>();
  private likes = new Set<string>();
  private follows = new Set<string>();
  private reports = new Set<string>();
  private logs: any[] = [];
  constructor(
    private role: (u: string, w: string, r: WorkspaceRole) => Promise<void>,
    private user: (id: string) => Promise<{ id: string; name: string } | null>,
  ) {}
  async listOwned(u: string, w: string) {
    await this.role(u, w, "viewer");
    return [...this.works.values()].filter(
      (x) => x.ownerId === u && x.workspaceId === w,
    );
  }
  async create(u: string, x: CommunityWork) {
    await this.role(u, x.workspaceId, "editor");
    this.works.set(x.id, x);
    return x;
  }
  async mutate(
    u: string,
    id: string,
    expected: number,
    key: string,
    hash: string,
    patch: any,
    submit: boolean,
  ) {
    const x = this.works.get(id);
    if (!x || x.ownerId !== u) throw missing();
    const mk = `${id}:${key}`,
      old = this.mutations.get(mk);
    if (old) {
      if (old !== hash) throw conflict();
      return { work: x, replayed: true };
    }
    if (x.revision !== expected) throw revision();
    if (!["draft", "rejected"].includes(x.status))
      throw new DomainError("COMMUNITY_WORK_LOCKED", 409, "当前状态不可修改");
    Object.assign(x, patch, {
      status: submit ? "pending" : x.status,
      revision: x.revision + 1,
      updatedAt: new Date().toISOString(),
      moderationReason: submit ? "" : x.moderationReason,
    });
    this.mutations.set(mk, hash);
    return { work: x, replayed: false };
  }
  async feed(i: {
    query?: string;
    tag?: string;
    cursor?: string;
    limit: number;
  }) {
    let a = [...this.works.values()].filter(
      (x) =>
        x.status === "published" &&
        x.visibility === "public" &&
        (!i.query ||
          `${x.title} ${x.description}`
            .toLowerCase()
            .includes(i.query.toLowerCase())) &&
        (!i.tag || x.tags.includes(i.tag)),
    );
    if (i.cursor) a = a.filter((x) => x.updatedAt < i.cursor!);
    a.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    const page = a.slice(0, i.limit),
      items = await Promise.all(page.map((x) => this.view(x)));
    return {
      items,
      nextCursor: a.length > i.limit ? page.at(-1)!.updatedAt : null,
    };
  }
  async detail(id: string, u?: string) {
    const x = this.works.get(id);
    if (!x || x.status !== "published" || x.visibility === "private")
      return null;
    return this.view(x, u);
  }
  async author(id: string, u?: string) {
    const author = await this.user(id);
    if (!author) throw new DomainError("AUTHOR_NOT_FOUND", 404, "作者不存在");
    const works = await Promise.all(
      [...this.works.values()]
        .filter(
          (x) =>
            x.ownerId === id &&
            x.status === "published" &&
            x.visibility === "public",
        )
        .map((x) => this.view(x, u)),
    );
    return {
      author,
      works,
      followerCount: [...this.follows].filter((x) => x.endsWith(`:${id}`))
        .length,
      following: !!u && this.follows.has(`${u}:${id}`),
    };
  }
  async like(u: string, id: string, value: boolean) {
    const x = this.works.get(id);
    if (!x || x.status !== "published") throw missing();
    const k = `${u}:${id}`;
    value ? this.likes.add(k) : this.likes.delete(k);
    return {
      liked: value,
      likeCount: [...this.likes].filter((y) => y.endsWith(`:${id}`)).length,
    };
  }
  async follow(u: string, a: string, value: boolean) {
    if (u === a)
      throw new DomainError("COMMUNITY_SELF_FOLLOW", 422, "不能关注自己");
    if (!(await this.user(a)))
      throw new DomainError("AUTHOR_NOT_FOUND", 404, "作者不存在");
    const k = `${u}:${a}`;
    value ? this.follows.add(k) : this.follows.delete(k);
    return {
      following: value,
      followerCount: [...this.follows].filter((x) => x.endsWith(`:${a}`))
        .length,
    };
  }
  async report(u: string, id: string, code: string, _d: string, now: string) {
    if (!this.works.has(id)) throw missing();
    const k = `${u}:${id}:${code}`;
    if (this.reports.has(k)) return;
    this.reports.add(k);
    this.logs.push({
      action: "report.created",
      resourceId: id,
      actorId: u,
      reason: code,
      createdAt: now,
    });
  }
  async moderate(
    id: string,
    d: "approve" | "reject" | "take_down" | "restore",
    reason: string,
    requestId: string,
    now: string,
  ) {
    const x = this.works.get(id);
    if (!x) throw missing();
    if (
      this.logs.some(
        (log) =>
          log.resourceId === id &&
          log.requestId === requestId &&
          log.action === `work.${d}`,
      )
    )
      return x;
    if (d === "approve") {
      if (x.status !== "pending") throw state();
      x.status = "published";
      this.versions.push({
        id: crypto.randomUUID(),
        workId: id,
        workspaceId: x.workspaceId,
        version: this.versions.filter((v) => v.workId === id).length + 1,
        snapshot: structuredClone(x.draftSnapshot),
        reviewedBy: null,
        publishedAt: now,
      });
    } else if (d === "reject") {
      if (x.status !== "pending") throw state();
      x.status = "rejected";
    } else if (d === "take_down") {
      if (x.status !== "published") throw state();
      x.status = "taken_down";
    } else {
      if (x.status !== "taken_down") throw state();
      x.status = "published";
    }
    x.moderationReason = reason;
    x.updatedAt = now;
    this.logs.push({
      action: `work.${d}`,
      resourceId: id,
      reason,
      requestId,
      createdAt: now,
    });
    return x;
  }
  async audit(id: string) {
    return this.logs.filter((x) => x.resourceId === id);
  }
  private async view(x: CommunityWork, u?: string): Promise<CommunityView> {
    return {
      ...x,
      author: (await this.user(x.ownerId))!,
      likeCount: [...this.likes].filter((y) => y.endsWith(`:${x.id}`)).length,
      liked: u ? this.likes.has(`${u}:${x.id}`) : undefined,
      followerCount: [...this.follows].filter((y) =>
        y.endsWith(`:${x.ownerId}`),
      ).length,
      version: this.versions.filter((v) => v.workId === x.id).at(-1) || null,
    };
  }
}
const missing = () =>
  new DomainError("COMMUNITY_WORK_NOT_FOUND", 404, "作品不存在");
const conflict = () =>
  new DomainError("COMMUNITY_IDEMPOTENCY_CONFLICT", 409, "幂等键内容漂移");
const revision = () =>
  new DomainError("REVISION_CONFLICT", 409, "作品版本冲突");
const state = () =>
  new DomainError("COMMUNITY_STATE_CONFLICT", 409, "作品状态不允许该操作");
