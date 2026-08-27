import { createHash } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { ProjectService } from "./services.js";
import type { DramaService } from "./drama-service.js";
import type { DramaProductionService } from "./drama-production-service.js";
import type { DramaRenderService } from "./drama-render-service.js";
type Target =
  | {
      type: "entity";
      kind: "character" | "scene" | "prop";
      name: string;
      description?: string;
      prompt?: string;
      sortOrder: number;
    }
  | {
      type: "timeline";
      shotId?: string;
      kind: "dialogue" | "voice" | "bgm" | "subtitle";
      textContent?: string;
      voice?: string;
      startMs: number;
      endMs: number;
      sortOrder: number;
    };
export class DramaInteropService {
  constructor(
    private platform: PlatformRepository,
    private projects: ProjectService,
    private drama: DramaService,
    private production: DramaProductionService,
    private renders: DramaRenderService,
  ) {}
  async toCanvas(
    userId: string,
    id: string,
    input: {
      canvasProjectId: string;
      assetId: string;
      expectedCanvasRevision: number;
      mutationId: string;
      title?: string;
      position: { x: number; y: number };
    },
  ) {
    const [d, p, r, canvas, asset] = await Promise.all([
      this.drama.get(userId, id),
      this.production.get(userId, id),
      this.renders.list(userId, id),
      this.projects.get(userId, input.canvasProjectId),
      this.platform.getAsset(userId, input.assetId),
    ]);
    if (!canvas)
      throw new DomainError("PROJECT_NOT_FOUND", 404, "Canvas 项目不存在");
    if (
      canvas.workspaceId !== d.project.workspaceId ||
      !asset ||
      asset.workspaceId !== d.project.workspaceId
    )
      throw new DomainError(
        "DRAMA_TRANSFER_WORKSPACE_MISMATCH",
        422,
        "互通资源不属于同一空间",
      );
    const referenced = new Set(
      [
        d.project.sourceAssetId,
        ...d.entities.map((x) => x.referenceAssetId),
        ...p.generations.map((x) => x.selectedAssetId),
        ...p.timeline.map((x) => x.assetId),
        ...r.versions.map((x) => x.assetId),
      ].filter((x): x is string => !!x),
    );
    if (!referenced.has(asset.id))
      throw new DomainError(
        "DRAMA_ASSET_NOT_LINKED",
        422,
        "素材尚未关联到该短剧",
      );
    const nodeId = `drama-${createHash("sha256").update(`${id}:${input.mutationId}`).digest("hex").slice(0, 24)}`;
    const node = {
      id: nodeId,
      type: asset.kind,
      title: input.title?.trim() || asset.originalName,
      position: input.position,
      width: asset.kind === "audio" ? 360 : 480,
      height: asset.kind === "audio" ? 160 : 320,
      schemaVersion: 1,
      metadata: {
        assetId: asset.id,
        mimeType: asset.mimeType,
        originalName: asset.originalName,
        dramaProjectId: id,
        transferDirection: "drama_to_canvas",
      },
    };
    const mutation = await this.projects.mutate(userId, input.canvasProjectId, {
      mutationId: input.mutationId,
      projectId: input.canvasProjectId,
      baseRevision: input.expectedCanvasRevision,
      clientId: "drama-interop",
      createdAt: new Date().toISOString(),
      operations: [{ type: "node.upsert", node }],
    });
    return { node, mutation };
  }
  async fromCanvas(
    userId: string,
    id: string,
    input: {
      canvasProjectId: string;
      nodeId: string;
      expectedDramaRevision: number;
      mutationId: string;
      target: Target;
    },
  ) {
    const [d, canvas] = await Promise.all([
      this.drama.get(userId, id),
      this.projects.get(userId, input.canvasProjectId),
    ]);
    if (!canvas)
      throw new DomainError("PROJECT_NOT_FOUND", 404, "Canvas 项目不存在");
    if (canvas.workspaceId !== d.project.workspaceId)
      throw new DomainError(
        "DRAMA_TRANSFER_WORKSPACE_MISMATCH",
        422,
        "Canvas 与短剧不属于同一空间",
      );
    const node = canvas.document.nodes.find((x) => x.id === input.nodeId);
    if (!node)
      throw new DomainError("CANVAS_NODE_NOT_FOUND", 404, "Canvas 节点不存在");
    const assetId =
      typeof node.metadata?.assetId === "string" ? node.metadata.assetId : "";
    if (!assetId)
      throw new DomainError(
        "CANVAS_NODE_ASSET_MISSING",
        422,
        "Canvas 节点未绑定云端素材",
      );
    return this.fromAsset(userId, id, {
      assetId,
      expectedDramaRevision: input.expectedDramaRevision,
      mutationId: input.mutationId,
      target: input.target,
    });
  }
  async fromAsset(
    userId: string,
    id: string,
    input: {
      assetId: string;
      expectedDramaRevision: number;
      mutationId: string;
      target: Target;
    },
  ) {
    const d = await this.drama.get(userId, id),
      asset = await this.platform.getAsset(userId, input.assetId);
    if (!asset || asset.workspaceId !== d.project.workspaceId)
      throw new DomainError(
        "DRAMA_TRANSFER_WORKSPACE_MISMATCH",
        422,
        "素材与短剧不属于同一空间",
      );
    if (input.target.type === "entity")
      return this.drama.addEntity(userId, id, {
        expectedRevision: input.expectedDramaRevision,
        mutationId: input.mutationId,
        kind: input.target.kind,
        name: input.target.name,
        description: input.target.description,
        prompt: input.target.prompt,
        referenceAssetId: asset.id,
        sortOrder: input.target.sortOrder,
      });
    return this.production.timeline(userId, id, {
      expectedRevision: input.expectedDramaRevision,
      mutationId: input.mutationId,
      shotId: input.target.shotId,
      kind: input.target.kind,
      textContent: input.target.textContent,
      voice: input.target.voice,
      assetId: asset.id,
      startMs: input.target.startMs,
      endMs: input.target.endMs,
      sortOrder: input.target.sortOrder,
    });
  }
}
