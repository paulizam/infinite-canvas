import { createHash, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { ProjectService } from "./services.js";
import type { CommunityRepository } from "./community-repository.js";
export class CommunityService {
  private actions = new Map<string, number[]>();
  constructor(
    private platform: PlatformRepository,
    private projects: ProjectService,
    private repository: CommunityRepository,
  ) {}
  feed(q?: string, tag?: string, cursor?: string, limit = 20) {
    return this.repository.feed({
      query: q?.trim(),
      tag: tag?.trim().toLowerCase(),
      cursor,
      limit: Math.min(50, Math.max(1, limit)),
    });
  }
  detail(id: string, userId?: string) {
    return this.repository.detail(id, userId);
  }
  author(id: string, userId?: string) {
    return this.repository.author(id, userId);
  }
  listOwned(u: string, w: string) {
    return this.repository.listOwned(u, w);
  }
  async create(
    u: string,
    w: string,
    input: {
      sourceProjectId: string;
      title: string;
      description?: string;
      coverAssetId?: string;
      tags?: string[];
      visibility: "public" | "unlisted" | "private";
    },
  ) {
    await this.platform.requireWorkspaceRole(u, w, "editor");
    const p = await this.projects.get(u, input.sourceProjectId);
    if (!p || p.workspaceId !== w)
      throw new DomainError(
        "COMMUNITY_SOURCE_INVALID",
        422,
        "来源项目不存在或不属于当前空间",
      );
    await this.cover(u, w, input.coverAssetId);
    const now = new Date().toISOString();
    return this.repository.create(u, {
      id: randomUUID(),
      workspaceId: w,
      ownerId: u,
      sourceProjectId: p.id,
      title: input.title.trim(),
      description: input.description?.trim() || "",
      coverAssetId: input.coverAssetId || null,
      tags: tags(input.tags),
      visibility: input.visibility,
      status: "draft",
      revision: 0,
      draftSnapshot: structuredClone(p.document) as unknown as Record<
        string,
        unknown
      >,
      moderationReason: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  async mutate(
    u: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      title?: string;
      description?: string;
      coverAssetId?: string | null;
      tags?: string[];
      visibility?: "public" | "unlisted" | "private";
    },
    submit = false,
  ) {
    const current = (
      await this.repository.listOwned(
        u,
        (await this.requireOwned(u, id)).workspaceId,
      )
    ).find((x) => x.id === id)!;
    await this.cover(u, current.workspaceId, input.coverAssetId || undefined);
    const project = current.sourceProjectId
      ? await this.projects.get(u, current.sourceProjectId)
      : null;
    const patch = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() }
        : {}),
      ...(input.coverAssetId !== undefined
        ? { coverAssetId: input.coverAssetId }
        : {}),
      ...(input.tags ? { tags: tags(input.tags) } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(submit && project
        ? {
            draftSnapshot: structuredClone(
              project.document,
            ) as unknown as Record<string, unknown>,
          }
        : {}),
    };
    return this.repository.mutate(
      u,
      id,
      input.expectedRevision,
      input.mutationId,
      createHash("sha256")
        .update(JSON.stringify({ patch, submit }))
        .digest("hex"),
      patch,
      submit,
    );
  }
  submit(
    u: string,
    id: string,
    input: { expectedRevision: number; mutationId: string },
  ) {
    return this.mutate(u, id, input, true);
  }
  like(u: string, id: string, value: boolean) {
    this.rate(u, "like", 60);
    return this.repository.like(u, id, value);
  }
  follow(u: string, a: string, value: boolean) {
    this.rate(u, "follow", 30);
    return this.repository.follow(u, a, value);
  }
  report(u: string, id: string, code: string, detail: string) {
    this.rate(u, "report", 10);
    return this.repository.report(
      u,
      id,
      code,
      detail.trim(),
      new Date().toISOString(),
    );
  }
  moderate(
    id: string,
    d: "approve" | "reject" | "take_down" | "restore",
    reason: string,
    requestId: string,
  ) {
    return this.repository.moderate(
      id,
      d,
      reason.trim(),
      requestId,
      new Date().toISOString(),
    );
  }
  audit(id: string) {
    return this.repository.audit(id);
  }
  private async requireOwned(u: string, id: string) {
    const view = await this.repository.detail(id, u);
    if (view?.ownerId === u) return view;
    for (const ws of await this.platform.listWorkspaces(u)) {
      const x = (await this.repository.listOwned(u, ws.id)).find(
        (y) => y.id === id,
      );
      if (x) return x;
    }
    throw new DomainError("COMMUNITY_WORK_NOT_FOUND", 404, "作品不存在");
  }
  private async cover(u: string, w: string, id?: string) {
    if (!id) return;
    const a = await this.platform.getAsset(u, id);
    if (!a || a.workspaceId !== w || a.kind !== "image")
      throw new DomainError(
        "COMMUNITY_COVER_INVALID",
        422,
        "封面必须是当前空间图片",
      );
  }
  private rate(u: string, a: string, max: number) {
    const k = `${u}:${a}`,
      now = Date.now(),
      list = (this.actions.get(k) || []).filter((x) => x > now - 60_000);
    if (list.length >= max)
      throw new DomainError("COMMUNITY_RATE_LIMITED", 429, "操作过于频繁");
    list.push(now);
    this.actions.set(k, list);
  }
}
function tags(v?: string[]) {
  return [
    ...new Set((v || []).map((x) => x.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 20);
}
