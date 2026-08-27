import { createHash, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type {
  DramaMutation,
  DramaRepository,
  DramaScriptVersion,
} from "./drama-repository.js";

export class DramaService {
  constructor(
    private platform: PlatformRepository,
    private repository: DramaRepository,
  ) {}
  list(userId: string, workspaceId: string) {
    return this.repository.list(userId, workspaceId);
  }
  async get(userId: string, id: string) {
    const value = await this.repository.get(userId, id);
    if (!value) throw new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
    return value;
  }
  async create(
    userId: string,
    workspaceId: string,
    input: { title: string; sourceText?: string; sourceAssetId?: string },
  ) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "editor");
    await this.asset(userId, workspaceId, input.sourceAssetId);
    const now = new Date().toISOString(),
      id = randomUUID();
    const project = {
      id,
      workspaceId,
      ownerId: userId,
      title: input.title.trim(),
      sourceText: input.sourceText?.trim() || "",
      sourceAssetId: input.sourceAssetId || null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    const script = project.sourceText
      ? this.script(project, userId, 1, {
          content: project.sourceText,
          segments: [],
          analysis: {},
          reviewStatus: "draft",
          operation: "import",
        })
      : null;
    return this.repository.create(userId, project, script);
  }
  async update(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      title: string;
      sourceText?: string;
      sourceAssetId?: string | null;
    },
  ) {
    const d = await this.get(userId, id);
    await this.asset(
      userId,
      d.project.workspaceId,
      input.sourceAssetId || undefined,
    );
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "project",
      title: input.title.trim(),
      sourceText: input.sourceText?.trim() || "",
      sourceAssetId: input.sourceAssetId || null,
    });
  }
  async addScript(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      content: string;
      segments?: unknown[];
      analysis?: Record<string, unknown>;
      reviewStatus: "draft" | "reviewing" | "approved" | "rejected";
      operation: "revision" | "split" | "merge" | "analysis";
    },
  ) {
    const d = await this.get(userId, id);
    const record = this.script(
      d.project,
      userId,
      (d.scripts[0]?.version || 0) + 1,
      {
        ...input,
        segments: input.segments || [],
        analysis: input.analysis || {},
      },
    );
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "script",
      record,
    });
  }
  async addEntity(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      kind: "character" | "scene" | "prop";
      name: string;
      description?: string;
      prompt?: string;
      referenceAssetId?: string;
      sortOrder: number;
    },
  ) {
    const d = await this.get(userId, id);
    await this.asset(userId, d.project.workspaceId, input.referenceAssetId);
    const now = new Date().toISOString();
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "entity",
      record: {
        id: randomUUID(),
        projectId: id,
        workspaceId: d.project.workspaceId,
        kind: input.kind,
        name: input.name.trim(),
        description: input.description?.trim() || "",
        prompt: input.prompt?.trim() || "",
        referenceAssetId: input.referenceAssetId || null,
        sortOrder: input.sortOrder,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  async addShot(
    userId: string,
    id: string,
    input: {
      expectedRevision: number;
      mutationId: string;
      title: string;
      prompt?: string;
      framing?: string;
      cameraMovement?: string;
      durationMs: number;
      sortOrder: number;
    },
  ) {
    const d = await this.get(userId, id),
      now = new Date().toISOString();
    return this.apply(userId, id, input.expectedRevision, input.mutationId, {
      type: "shot",
      record: {
        id: randomUUID(),
        projectId: id,
        workspaceId: d.project.workspaceId,
        title: input.title.trim(),
        prompt: input.prompt?.trim() || "",
        framing: input.framing?.trim() || "",
        cameraMovement: input.cameraMovement?.trim() || "",
        durationMs: input.durationMs,
        sortOrder: input.sortOrder,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  private apply(
    userId: string,
    id: string,
    rev: number,
    key: string,
    m: DramaMutation,
  ) {
    return this.repository.mutate(userId, id, rev, key, mutationHash(m), m);
  }
  private script(
    p: { id: string; workspaceId: string },
    userId: string,
    version: number,
    input: {
      content: string;
      segments: unknown[];
      analysis: Record<string, unknown>;
      reviewStatus: "draft" | "reviewing" | "approved" | "rejected";
      operation: "import" | "revision" | "split" | "merge" | "analysis";
    },
  ): DramaScriptVersion {
    return {
      id: randomUUID(),
      projectId: p.id,
      workspaceId: p.workspaceId,
      version,
      content: input.content,
      segments: input.segments,
      analysis: input.analysis,
      reviewStatus: input.reviewStatus,
      operation: input.operation,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
  }
  private async asset(userId: string, workspaceId: string, id?: string) {
    if (!id) return;
    const a = await this.platform.getAsset(userId, id);
    if (!a || a.workspaceId !== workspaceId)
      throw new DomainError(
        "DRAMA_ASSET_INVALID",
        422,
        "引用素材不存在或不属于当前空间",
      );
  }
}
function mutationHash(m: DramaMutation) {
  let stable: unknown = m;
  if (m.type === "script") {
    const { id, createdAt, version, ...record } = m.record;
    stable = { type: m.type, record };
  } else if (m.type === "entity") {
    const { id, createdAt, updatedAt, ...record } = m.record;
    stable = { type: m.type, record };
  } else if (m.type === "shot") {
    const { id, createdAt, updatedAt, ...record } = m.record;
    stable = { type: m.type, record };
  }
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
