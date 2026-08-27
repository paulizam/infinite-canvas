import { applyCanvasOperations } from "@infinite-canvas/canvas-core";
import type { CanvasMutation } from "@infinite-canvas/contracts";
import {
  DomainError,
  type MembershipRecord,
  type MutationResult,
  type PlatformRepository,
  type ProjectRecord,
  type ProjectCheckpointRecord,
  type SessionRecord,
  type UserRecord,
  type WorkspaceRecord,
  type WorkspaceRole,
  type AssetRecord,
} from "./domain.js";
import { extractAssetIds } from "./asset-references.js";
import { createHash } from "node:crypto";

export class MemoryPlatformRepository implements PlatformRepository {
  private users = new Map<string, UserRecord>();
  private emails = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private workspaces = new Map<string, WorkspaceRecord>();
  private memberships = new Map<string, MembershipRecord>();
  private projects = new Map<string, ProjectRecord>();
  private mutations = new Map<
    string,
    MutationResult & { requestHash: string }
  >();
  private checkpoints = new Map<string, ProjectCheckpointRecord>();
  private assets = new Map<string, AssetRecord>();

  async createUserWithWorkspace(input: {
    user: UserRecord;
    workspace: WorkspaceRecord;
    membership: MembershipRecord;
  }) {
    if (this.emails.has(input.user.email))
      throw new DomainError("EMAIL_EXISTS", 409, "邮箱已注册");
    this.users.set(input.user.id, input.user);
    this.emails.set(input.user.email, input.user.id);
    this.workspaces.set(input.workspace.id, input.workspace);
    this.memberships.set(
      this.memberKey(input.membership.workspaceId, input.membership.userId),
      input.membership,
    );
  }
  async findUserByEmail(email: string) {
    const id = this.emails.get(email);
    return id ? this.users.get(id) || null : null;
  }
  async findUserById(id: string) {
    return this.users.get(id) || null;
  }
  async createSession(session: SessionRecord) {
    this.sessions.set(session.tokenHash, session);
  }
  async findSession(tokenHash: string, now: string) {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? session : null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async listWorkspaces(userId: string) {
    return [...this.memberships.values()]
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const workspace = this.workspaces.get(m.workspaceId);
        return workspace ? [{ ...workspace, role: m.role }] : [];
      });
  }
  async createWorkspace(
    workspace: WorkspaceRecord,
    membership: MembershipRecord,
  ) {
    this.workspaces.set(workspace.id, workspace);
    this.memberships.set(
      this.memberKey(workspace.id, membership.userId),
      membership,
    );
  }
  async listProjects(userId: string, workspaceId: string) {
    await this.requireWorkspaceRole(userId, workspaceId, "viewer");
    return [...this.projects.values()]
      .filter((p) => p.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async createProject(userId: string, project: ProjectRecord) {
    await this.requireWorkspaceRole(userId, project.workspaceId, "editor");
    if (this.projects.has(project.id))
      throw new DomainError("PROJECT_EXISTS", 409, "项目已存在");
    this.projects.set(project.id, project);
  }
  async deleteProject(userId: string, projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.requireWorkspaceRole(userId, project.workspaceId, "editor");
    this.projects.delete(projectId);
    for (const key of this.mutations.keys())
      if (key.startsWith(`${projectId}:`)) this.mutations.delete(key);
    for (const [key, checkpoint] of this.checkpoints)
      if (checkpoint.projectId === projectId) this.checkpoints.delete(key);
  }
  async getProject(userId: string, projectId: string) {
    const project = this.projects.get(projectId);
    if (
      !project ||
      !this.memberships.has(this.memberKey(project.workspaceId, userId))
    )
      return null;
    return project;
  }
  async applyProjectMutation(
    userId: string,
    projectId: string,
    mutation: CanvasMutation,
  ): Promise<MutationResult> {
    const project = this.projects.get(projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.requireWorkspaceRole(userId, project.workspaceId, "editor");
    const key = `${projectId}:${mutation.mutationId}`;
    const replay = this.mutations.get(key);
    const { createdAt: _, ...semanticMutation } = mutation;
    const requestHash = createHash("sha256")
      .update(JSON.stringify(semanticMutation))
      .digest("hex");
    if (replay) {
      if (replay.requestHash !== requestHash)
        throw new DomainError(
          "MUTATION_IDEMPOTENCY_CONFLICT",
          409,
          "Mutation 幂等键内容漂移",
        );
      return { project: replay.project, replayed: true };
    }
    if (mutation.baseRevision !== project.document.revision)
      throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
    const document = applyCanvasOperations(
      project.document,
      mutation.operations,
    );
    const next = { ...project, document, updatedAt: document.updatedAt };
    const result = { project: next, replayed: false };
    this.projects.set(projectId, next);
    this.mutations.set(key, { ...result, requestHash });
    return result;
  }
  async listProjectCheckpoints(userId: string, projectId: string) {
    const project = await this.getProject(userId, projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    return [...this.checkpoints.values()]
      .filter((checkpoint) => checkpoint.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneCheckpoint);
  }
  async getProjectCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
  ) {
    if (!(await this.getProject(userId, projectId))) return null;
    const checkpoint = this.checkpoints.get(checkpointId);
    return checkpoint?.projectId === projectId
      ? cloneCheckpoint(checkpoint)
      : null;
  }
  async createProjectCheckpoint(
    userId: string,
    projectId: string,
    input: Pick<
      ProjectCheckpointRecord,
      "id" | "name" | "description" | "createdBy" | "createdAt"
    >,
  ) {
    const project = this.projects.get(projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.requireWorkspaceRole(userId, project.workspaceId, "editor");
    const checkpoint: ProjectCheckpointRecord = {
      ...input,
      projectId,
      workspaceId: project.workspaceId,
      sourceRevision: project.document.revision,
      snapshot: cloneDocument(project.document),
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    return cloneCheckpoint(checkpoint);
  }
  async deleteProjectCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
  ) {
    const project = this.projects.get(projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.requireWorkspaceRole(userId, project.workspaceId, "editor");
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.projectId !== projectId)
      throw new DomainError("CHECKPOINT_NOT_FOUND", 404, "Checkpoint 不存在");
    this.checkpoints.delete(checkpointId);
  }
  async restoreProjectCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
    expectedRevision: number,
    restoredAt: string,
  ) {
    const project = this.projects.get(projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.requireWorkspaceRole(userId, project.workspaceId, "editor");
    if (project.document.revision !== expectedRevision)
      throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.projectId !== projectId)
      throw new DomainError("CHECKPOINT_NOT_FOUND", 404, "Checkpoint 不存在");
    const document = {
      ...cloneDocument(checkpoint.snapshot),
      id: projectId,
      revision: expectedRevision + 1,
      updatedAt: restoredAt,
    };
    const restored = { ...project, document, updatedAt: restoredAt };
    this.projects.set(projectId, restored);
    return restored;
  }
  async findAssetByHash(userId: string, workspaceId: string, sha256: string) {
    await this.requireWorkspaceRole(userId, workspaceId, "viewer");
    return (
      [...this.assets.values()].find(
        (asset) => asset.workspaceId === workspaceId && asset.sha256 === sha256,
      ) || null
    );
  }
  async createAsset(userId: string, asset: AssetRecord) {
    await this.requireWorkspaceRole(userId, asset.workspaceId, "editor");
    const existing = [...this.assets.values()].find(
      (item) =>
        item.workspaceId === asset.workspaceId && item.sha256 === asset.sha256,
    );
    if (existing) return existing;
    this.assets.set(asset.id, asset);
    return asset;
  }
  async getAsset(userId: string, assetId: string) {
    const asset = this.assets.get(assetId);
    if (
      !asset ||
      !this.memberships.has(this.memberKey(asset.workspaceId, userId))
    )
      return null;
    return asset;
  }
  async listAssets(userId: string, workspaceId: string) {
    await this.requireWorkspaceRole(userId, workspaceId, "viewer");
    return [...this.assets.values()]
      .filter((asset) => asset.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async deleteAsset(userId: string, assetId: string) {
    const asset = this.assets.get(assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    await this.requireWorkspaceRole(userId, asset.workspaceId, "editor");
    const referenced = [...this.projects.values()].some(
      (project) =>
        project.workspaceId === asset.workspaceId &&
        extractAssetIds(project.document).has(assetId),
    );
    if (referenced)
      throw new DomainError("ASSET_IN_USE", 409, "素材仍被项目引用");
    this.assets.delete(assetId);
    return asset;
  }
  private memberKey(workspaceId: string, userId: string) {
    return `${workspaceId}:${userId}`;
  }
  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    minimum: WorkspaceRole,
  ) {
    const member = this.memberships.get(this.memberKey(workspaceId, userId));
    const rank: Record<WorkspaceRole, number> = {
      viewer: 0,
      editor: 1,
      admin: 2,
      owner: 3,
    };
    if (!member) throw new DomainError("FORBIDDEN", 403, "无权访问工作空间");
    if (rank[member.role] < rank[minimum])
      throw new DomainError("FORBIDDEN", 403, "权限不足");
  }
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function cloneCheckpoint(
  value: ProjectCheckpointRecord,
): ProjectCheckpointRecord {
  return { ...value, snapshot: cloneDocument(value.snapshot) };
}
