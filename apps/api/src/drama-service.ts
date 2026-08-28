import { createHash, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type {
  DramaMutation,
  DramaRepository,
  DramaScriptVersion,
} from "./drama-repository.js";
import type { GenerationJobService } from "./generation-job-service.js";

export class DramaService {
  constructor(
    private platform: PlatformRepository,
    private repository: DramaRepository,
    private jobs?: GenerationJobService,
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
  async createScriptAnalysis(
    userId: string,
    id: string,
    input: { expectedRevision: number; mutationId: string; scriptVersionId: string; logicalModelId: string },
  ) {
    if (!this.jobs) throw new DomainError("DRAMA_ANALYSIS_UNAVAILABLE", 502, "剧本分析服务未配置");
    const d = await this.get(userId, id);
    if (d.project.revision !== input.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
    const script = d.scripts.find((value) => value.id === input.scriptVersionId);
    if (!script) throw new DomainError("DRAMA_SCRIPT_NOT_FOUND", 404, "剧本版本不存在");
    const sourceHash = createHash("sha256").update(script.content).digest("hex");
    return this.jobs.create(userId, d.project.workspaceId, {
      capability: "text",
      logicalModelId: input.logicalModelId,
      clientRequestId: `drama-analysis:${id}:${input.mutationId}`,
      parameters: {
        dramaOperation: "script_analysis",
        dramaProjectId: id,
        scriptVersionId: script.id,
        sourceHash,
        prompt: analysisPrompt(script.content),
      },
    });
  }
  async listScriptAnalyses(userId: string, id: string) {
    if (!this.jobs) throw new DomainError("DRAMA_ANALYSIS_UNAVAILABLE", 502, "剧本分析服务未配置");
    const d = await this.get(userId, id);
    return (await this.jobs.listWorkspace(userId, d.project.workspaceId)).filter(
      (job) => job.input.dramaOperation === "script_analysis" && job.input.dramaProjectId === id,
    );
  }
  async applyScriptAnalysis(
    userId: string,
    id: string,
    input: { expectedRevision: number; mutationId: string; jobId: string },
  ) {
    if (!this.jobs) throw new DomainError("DRAMA_ANALYSIS_UNAVAILABLE", 502, "剧本分析服务未配置");
    const d = await this.get(userId, id);
    const job = await this.jobs.getWorkspace(userId, d.project.workspaceId, input.jobId);
    if (!job || job.workspaceId !== d.project.workspaceId || job.input.dramaProjectId !== id || job.input.dramaOperation !== "script_analysis")
      throw new DomainError("DRAMA_ANALYSIS_NOT_FOUND", 404, "剧本分析任务不存在");
    if (job.status !== "succeeded" || typeof job.result?.text !== "string")
      throw new DomainError("DRAMA_ANALYSIS_NOT_READY", 409, "剧本分析任务尚未成功完成");
    const script = d.scripts.find((value) => value.id === job.input.scriptVersionId);
    if (!script || createHash("sha256").update(script.content).digest("hex") !== job.input.sourceHash)
      throw new DomainError("DRAMA_ANALYSIS_SOURCE_DRIFT", 409, "剧本分析来源已漂移");
    const analysis = parseAnalysis(job.result.text);
    return this.addScript(userId, id, {
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      content: script.content,
      segments: analysis.segments,
      analysis: { summary: analysis.summary, safety: analysis.safety, sourceJobId: job.id, sourceScriptVersionId: script.id },
      reviewStatus: "reviewing",
      operation: "analysis",
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
function analysisPrompt(content: string) {
  return `你是短剧剧本分析器。只返回严格 JSON，不要 Markdown。结构：{"summary":"摘要","safety":{"status":"passed|needs_review","issues":["问题"]},"segments":[{"title":"分段标题","content":"原文片段","characters":["角色"],"scene":"场景"}]}。segments 必须忠于原文，不得添加原文没有的剧情。\n\n剧本：\n${content}`;
}
function parseAnalysis(text: string): { summary: string; safety: { status: "passed" | "needs_review"; issues: string[] }; segments: Array<Record<string, unknown>> } {
  let value: unknown;
  try { value = JSON.parse(text.trim()); } catch { throw new DomainError("DRAMA_ANALYSIS_INVALID_RESULT", 422, "剧本分析结果不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("DRAMA_ANALYSIS_INVALID_RESULT", 422, "剧本分析结果结构无效");
  const record = value as Record<string, unknown>, safety = record.safety as Record<string, unknown> | undefined;
  if (typeof record.summary !== "string" || record.summary.length > 20_000 || !safety || !["passed", "needs_review"].includes(String(safety.status)) || !Array.isArray(safety.issues) || safety.issues.some((x) => typeof x !== "string") || safety.issues.length > 100 || !Array.isArray(record.segments) || record.segments.length > 10_000 || record.segments.some((x) => !x || typeof x !== "object" || Array.isArray(x)))
    throw new DomainError("DRAMA_ANALYSIS_INVALID_RESULT", 422, "剧本分析结果结构无效");
  return { summary: record.summary, safety: { status: safety.status as "passed" | "needs_review", issues: safety.issues as string[] }, segments: record.segments as Array<Record<string, unknown>> };
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
