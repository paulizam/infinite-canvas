import { DomainError } from "./domain.js";
export type CommunityComment = {
  id: string;
  workId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  content: string;
  status: "visible" | "hidden" | "deleted";
  createdAt: string;
  updatedAt: string;
};
export type CommunityCollection = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  visibility: "public" | "unlisted" | "private";
  revision: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{ workId: string; sortOrder: number }>;
};
export interface CommunitySocialRepository {
  comments(
    workId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: CommunityComment[]; nextCursor: string | null }>;
  comment(
    userId: string,
    input: {
      id: string;
      workId: string;
      parentId: string | null;
      content: string;
      mutationId: string;
      now: string;
    },
  ): Promise<{ comment: CommunityComment; replayed: boolean }>;
  reportComment(
    userId: string,
    id: string,
    code: string,
    detail: string,
    now: string,
  ): Promise<void>;
  moderateComment(
    id: string,
    action: "hide" | "restore",
    reason: string,
    requestId: string,
    now: string,
  ): Promise<CommunityComment>;
  bookmark(
    userId: string,
    workId: string,
    value: boolean,
  ): Promise<{ bookmarked: boolean; bookmarkCount: number }>;
  bookmarks(userId: string): Promise<string[]>;
  createCollection(
    userId: string,
    input: Omit<CommunityCollection, "items">,
  ): Promise<CommunityCollection>;
  mutateCollection(
    userId: string,
    id: string,
    expected: number,
    key: string,
    hash: string,
    patch: {
      title?: string;
      description?: string;
      visibility?: "public" | "unlisted" | "private";
      item?: { workId: string; sortOrder: number; value: boolean };
    },
    now: string,
  ): Promise<{ collection: CommunityCollection; replayed: boolean }>;
  collection(id: string, userId?: string): Promise<CommunityCollection | null>;
  collectionsByAuthor(
    authorId: string,
    userId?: string,
  ): Promise<CommunityCollection[]>;
}
export class MemoryCommunitySocialRepository implements CommunitySocialRepository {
  private cs: CommunityComment[] = [];
  private reports = new Set<string>();
  private marks = new Set<string>();
  private cols = new Map<string, CommunityCollection>();
  private mutations = new Map<string, string>();
  private logs: any[] = [];
  constructor(
    private published: (id: string) => Promise<boolean>,
    private user: (id: string) => Promise<{ name: string } | null>,
  ) {}
  async comments(w: string, cursor: string | undefined, limit: number) {
    let a = this.cs
      .filter(
        (x) =>
          x.workId === w &&
          x.status === "visible" &&
          (!cursor || x.createdAt > cursor),
      )
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    return {
      items: a.slice(0, limit),
      nextCursor: a.length > limit ? a[limit - 1]!.createdAt : null,
    };
  }
  async comment(
    u: string,
    i: {
      id: string;
      workId: string;
      parentId: string | null;
      content: string;
      mutationId: string;
      now: string;
    },
  ) {
    const old = this.cs.find(
      (x) => (x as any).mutationId === `${u}:${i.mutationId}`,
    );
    if (old) {
      if (old.content !== i.content || old.workId !== i.workId)
        throw conflict();
      return { comment: old, replayed: true };
    }
    if (!(await this.published(i.workId))) throw missing();
    if (
      i.parentId &&
      !this.cs.some((x) => x.id === i.parentId && x.workId === i.workId)
    )
      throw new DomainError(
        "COMMUNITY_PARENT_COMMENT_INVALID",
        422,
        "父评论不存在",
      );
    const user = await this.user(u),
      x = {
        id: i.id,
        workId: i.workId,
        authorId: u,
        authorName: user?.name || "",
        parentId: i.parentId,
        content: i.content,
        status: "visible" as const,
        createdAt: i.now,
        updatedAt: i.now,
      };
    (x as any).mutationId = `${u}:${i.mutationId}`;
    this.cs.push(x);
    return { comment: x, replayed: false };
  }
  async reportComment(
    u: string,
    id: string,
    code: string,
    _detail: string,
    now: string,
  ) {
    if (!this.cs.some((x) => x.id === id)) throw commentMissing();
    const k = `${u}:${id}:${code}`;
    if (this.reports.has(k)) return;
    this.reports.add(k);
    this.logs.push({
      resourceId: id,
      action: "comment.reported",
      reason: code,
      createdAt: now,
    });
  }
  async moderateComment(
    id: string,
    a: "hide" | "restore",
    reason: string,
    requestId: string,
    now: string,
  ) {
    const x = this.cs.find((y) => y.id === id);
    if (!x) throw commentMissing();
    const action = `comment.${a}`;
    if (
      this.logs.some(
        (y) =>
          y.resourceId === id &&
          y.action === action &&
          y.requestId === requestId,
      )
    )
      return x;
    x.status = a === "hide" ? "hidden" : "visible";
    x.updatedAt = now;
    this.logs.push({
      resourceId: id,
      action,
      reason,
      requestId,
      createdAt: now,
    });
    return x;
  }
  async bookmark(u: string, w: string, v: boolean) {
    if (!(await this.published(w))) throw missing();
    const k = `${u}:${w}`;
    v ? this.marks.add(k) : this.marks.delete(k);
    return {
      bookmarked: v,
      bookmarkCount: [...this.marks].filter((x) => x.endsWith(`:${w}`)).length,
    };
  }
  async bookmarks(u: string) {
    return [...this.marks]
      .filter((x) => x.startsWith(`${u}:`))
      .map((x) => x.split(":")[1]!);
  }
  async createCollection(u: string, i: Omit<CommunityCollection, "items">) {
    const x = { ...i, ownerId: u, items: [] };
    this.cols.set(x.id, x);
    return x;
  }
  async mutateCollection(
    u: string,
    id: string,
    e: number,
    key: string,
    hash: string,
    p: any,
    now: string,
  ) {
    const x = this.cols.get(id);
    if (!x || x.ownerId !== u) throw collectionMissing();
    const k = `${id}:${key}`,
      old = this.mutations.get(k);
    if (old) {
      if (old !== hash) throw conflict();
      return { collection: x, replayed: true };
    }
    if (x.revision !== e) throw revision();
    if (p.item) {
      if (p.item.value) {
        if (!(await this.published(p.item.workId))) throw missing();
        const oldItem = x.items.find((y) => y.workId === p.item.workId);
        oldItem
          ? (oldItem.sortOrder = p.item.sortOrder)
          : x.items.push({
              workId: p.item.workId,
              sortOrder: p.item.sortOrder,
            });
      } else x.items = x.items.filter((y) => y.workId !== p.item.workId);
    }
    Object.assign(x, {
      ...p,
      item: undefined,
      revision: e + 1,
      updatedAt: now,
    });
    this.mutations.set(k, hash);
    return { collection: x, replayed: false };
  }
  async collection(id: string, u?: string) {
    const x = this.cols.get(id);
    return x && (x.visibility !== "private" || x.ownerId === u) ? x : null;
  }
  async collectionsByAuthor(a: string, u?: string) {
    return [...this.cols.values()].filter(
      (x) => x.ownerId === a && (x.visibility !== "private" || u === a),
    );
  }
}
const missing = () =>
  new DomainError("COMMUNITY_WORK_NOT_FOUND", 404, "作品不存在");
const commentMissing = () =>
  new DomainError("COMMUNITY_COMMENT_NOT_FOUND", 404, "评论不存在");
const collectionMissing = () =>
  new DomainError("COMMUNITY_COLLECTION_NOT_FOUND", 404, "合集不存在");
const conflict = () =>
  new DomainError("COMMUNITY_IDEMPOTENCY_CONFLICT", 409, "幂等键内容漂移");
const revision = () =>
  new DomainError("REVISION_CONFLICT", 409, "合集版本冲突");
