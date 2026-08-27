import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type { CommunitySocialRepository } from "./community-social-repository.js";
export class CommunitySocialService {
  private actions = new Map<string, number[]>();
  constructor(private repository: CommunitySocialRepository) {}
  comments(w: string, c?: string, l = 50) {
    return this.repository.comments(w, c, Math.min(100, Math.max(1, l)));
  }
  comment(
    u: string,
    w: string,
    i: { mutationId: string; parentId?: string; content: string },
  ) {
    this.rate(u, "comment", 20);
    return this.repository.comment(u, {
      id: randomUUID(),
      workId: w,
      parentId: i.parentId || null,
      content: i.content.trim(),
      mutationId: i.mutationId,
      now: new Date().toISOString(),
    });
  }
  report(u: string, id: string, code: string, detail: string) {
    this.rate(u, "comment-report", 10);
    return this.repository.reportComment(
      u,
      id,
      code,
      detail.trim(),
      new Date().toISOString(),
    );
  }
  moderate(
    id: string,
    a: "hide" | "restore",
    reason: string,
    requestId: string,
  ) {
    return this.repository.moderateComment(
      id,
      a,
      reason.trim(),
      requestId,
      new Date().toISOString(),
    );
  }
  bookmark(u: string, w: string, v: boolean) {
    this.rate(u, "bookmark", 120);
    return this.repository.bookmark(u, w, v);
  }
  bookmarks(u: string) {
    return this.repository.bookmarks(u);
  }
  createCollection(
    u: string,
    i: {
      title: string;
      description?: string;
      visibility: "public" | "unlisted" | "private";
    },
  ) {
    const now = new Date().toISOString();
    return this.repository.createCollection(u, {
      id: randomUUID(),
      ownerId: u,
      title: i.title.trim(),
      description: i.description?.trim() || "",
      visibility: i.visibility,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  mutateCollection(
    u: string,
    id: string,
    i: {
      expectedRevision: number;
      mutationId: string;
      title?: string;
      description?: string;
      visibility?: "public" | "unlisted" | "private";
      item?: { workId: string; sortOrder: number; value: boolean };
    },
  ) {
    const patch = {
      ...(i.title !== undefined ? { title: i.title.trim() } : {}),
      ...(i.description !== undefined
        ? { description: i.description.trim() }
        : {}),
      ...(i.visibility ? { visibility: i.visibility } : {}),
      ...(i.item ? { item: i.item } : {}),
    };
    return this.repository.mutateCollection(
      u,
      id,
      i.expectedRevision,
      i.mutationId,
      createHash("sha256").update(JSON.stringify(patch)).digest("hex"),
      patch,
      new Date().toISOString(),
    );
  }
  collection(id: string, u?: string) {
    return this.repository.collection(id, u);
  }
  collections(a: string, u?: string) {
    return this.repository.collectionsByAuthor(a, u);
  }
  private rate(u: string, a: string, max: number) {
    const key = `${u}:${a}`,
      now = Date.now(),
      x = (this.actions.get(key) || []).filter((t) => t > now - 60_000);
    if (x.length >= max)
      throw new DomainError("COMMUNITY_RATE_LIMITED", 429, "操作过于频繁");
    x.push(now);
    this.actions.set(key, x);
  }
}
