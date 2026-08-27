import { createHash, randomUUID } from "node:crypto";
import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import { validateWorkflow } from "@infinite-canvas/workflow-runtime";
import { DomainError, type PlatformRepository } from "./domain.js";
import { BUILTIN_WORKFLOW_RULES } from "./workflow-service.js";
import type { WorkflowRepository } from "./workflow-repository.js";
import type {
  WorkflowLibraryMetadata,
  WorkflowLibraryRepository,
} from "./workflow-library-repository.js";

export type WorkflowBundle = {
  format: "infinite-canvas.workflow";
  formatVersion: 1;
  exportedAt: string;
  workflow: { name: string; description: string; tags: string[] };
  version: { number: number; definition: WorkflowDefinition };
  checksum: string;
};

export class WorkflowLibraryService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly workflows: WorkflowRepository,
    private readonly library: WorkflowLibraryRepository,
  ) {}
  async list(userId: string, workspaceId: string) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "viewer");
    const [workflows, metadata, folders] = await Promise.all([
      this.workflows.listByWorkspace(userId, workspaceId),
      this.library.listMetadata(userId, workspaceId),
      this.library.listFolders(userId, workspaceId),
    ]);
    const byWorkflow = new Map(metadata.map((item) => [item.workflowId, item]));
    return {
      folders,
      workflows: workflows.map((workflow) => ({
        workflow,
        metadata:
          byWorkflow.get(workflow.id) ||
          emptyMetadata(workflow.id, workspaceId, workflow.updatedAt),
      })),
    };
  }
  async createFolder(userId: string, workspaceId: string, name: string) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "editor");
    const now = new Date().toISOString();
    return this.library.createFolder({
      id: randomUUID(),
      workspaceId,
      name,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  }
  deleteFolder(userId: string, folderId: string) {
    return this.library.deleteFolder(userId, folderId);
  }
  async updateMetadata(
    userId: string,
    workflowId: string,
    patch: Partial<
      Pick<
        WorkflowLibraryMetadata,
        "folderId" | "coverAssetId" | "description" | "tags" | "isTemplate"
      >
    >,
  ) {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    await this.platform.requireWorkspaceRole(
      userId,
      publication.workflow.workspaceId,
      "editor",
    );
    const current =
      (
        await this.library.listMetadata(
          userId,
          publication.workflow.workspaceId,
        )
      ).find((item) => item.workflowId === workflowId) ||
      emptyMetadata(
        workflowId,
        publication.workflow.workspaceId,
        publication.workflow.updatedAt,
      );
    if (patch.coverAssetId) {
      const asset = await this.platform.getAsset(userId, patch.coverAssetId);
      if (!asset || asset.workspaceId !== publication.workflow.workspaceId)
        throw new DomainError("COVER_ASSET_NOT_FOUND", 404, "封面素材不存在");
    }
    return this.library.upsertMetadata(userId, {
      ...current,
      ...patch,
      workflowId,
      workspaceId: publication.workflow.workspaceId,
      updatedAt: new Date().toISOString(),
    });
  }
  async export(
    userId: string,
    workflowId: string,
    versionNumber?: number,
  ): Promise<WorkflowBundle> {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    const version = versionNumber
      ? (await this.workflows.listVersions(userId, workflowId)).find(
          (item) => item.version === versionNumber,
        )
      : publication.version;
    if (!version)
      throw new DomainError(
        "WORKFLOW_VERSION_NOT_FOUND",
        404,
        "Workflow 版本不存在",
      );
    const metadata = (
      await this.library.listMetadata(userId, publication.workflow.workspaceId)
    ).find((item) => item.workflowId === workflowId);
    const payload = {
      format: "infinite-canvas.workflow" as const,
      formatVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      workflow: {
        name: publication.workflow.name,
        description: metadata?.description || "",
        tags: metadata?.tags || [],
      },
      version: { number: version.version, definition: version.definition },
    };
    return { ...payload, checksum: digest(payload) };
  }
  async import(
    userId: string,
    workspaceId: string,
    bundle: WorkflowBundle,
    name?: string,
  ) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "editor");
    if (
      bundle.format !== "infinite-canvas.workflow" ||
      bundle.formatVersion !== 1 ||
      digest(withoutChecksum(bundle)) !== bundle.checksum
    )
      throw new DomainError(
        "WORKFLOW_BUNDLE_INVALID",
        422,
        "Workflow bundle 格式或 checksum 无效",
      );
    if (
      bundle.version.definition.nodes.some(
        (node) => node.credentialRefs?.length,
      )
    )
      throw new DomainError(
        "WORKFLOW_CREDENTIAL_IMPORT_DENIED",
        422,
        "导入文件不能携带 credential 引用",
      );
    const workflowId = randomUUID();
    const definition = structuredClone(bundle.version.definition);
    definition.id = workflowId;
    definition.name = name?.trim() || bundle.workflow.name;
    const validation = validateWorkflow(definition, {
      knownNodeTypes: new Set(
        BUILTIN_WORKFLOW_RULES.map((rule) => rule.schema.type),
      ),
    });
    if (!validation.valid)
      throw new DomainError(
        "WORKFLOW_BUNDLE_INVALID",
        422,
        validation.issues
          .map((item) => `${item.code}:${item.message}`)
          .join("; "),
      );
    const now = new Date().toISOString();
    const publication = await this.workflows.importVersion({
      workflowId,
      userId,
      workspaceId,
      name: definition.name,
      definition,
      publicationId: `import:${randomUUID()}`,
      now,
    });
    await this.library.upsertMetadata(userId, {
      ...emptyMetadata(workflowId, workspaceId, now),
      description: bundle.workflow.description.slice(0, 2_000),
      tags: bundle.workflow.tags.slice(0, 20),
    });
    return publication;
  }
  async instantiateTemplate(userId: string, workflowId: string, name?: string) {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    const metadata = (
      await this.library.listMetadata(userId, publication.workflow.workspaceId)
    ).find((item) => item.workflowId === workflowId);
    if (!metadata?.isTemplate)
      throw new DomainError("WORKFLOW_NOT_TEMPLATE", 409, "Workflow 不是模板");
    return this.import(
      userId,
      publication.workflow.workspaceId,
      await this.export(userId, workflowId),
      name,
    );
  }
}

function emptyMetadata(
  workflowId: string,
  workspaceId: string,
  updatedAt: string,
): WorkflowLibraryMetadata {
  return {
    workflowId,
    workspaceId,
    folderId: null,
    coverAssetId: null,
    description: "",
    tags: [],
    isTemplate: false,
    updatedAt,
  };
}
function withoutChecksum(bundle: WorkflowBundle) {
  const { checksum: _checksum, ...payload } = bundle;
  return payload;
}
function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
