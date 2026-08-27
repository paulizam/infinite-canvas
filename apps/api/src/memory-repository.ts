import { applyCanvasOperations } from "@infinite-canvas/canvas-core";
import type { CanvasMutation } from "@infinite-canvas/contracts";
import {
  DomainError,
  type MembershipRecord,
  type MutationResult,
  type PlatformRepository,
  type ProjectRecord,
  type SessionRecord,
  type UserRecord,
  type WorkspaceRecord,
  type WorkspaceRole,
} from "./domain.js";

export class MemoryPlatformRepository implements PlatformRepository {
  private users = new Map<string, UserRecord>();
  private emails = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private workspaces = new Map<string, WorkspaceRecord>();
  private memberships = new Map<string, MembershipRecord>();
  private projects = new Map<string, ProjectRecord>();
  private mutations = new Map<string, MutationResult>();

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
    this.requireRole(userId, workspaceId, "viewer");
    return [...this.projects.values()]
      .filter((p) => p.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async createProject(userId: string, project: ProjectRecord) {
    this.requireRole(userId, project.workspaceId, "editor");
    if (this.projects.has(project.id))
      throw new DomainError("PROJECT_EXISTS", 409, "项目已存在");
    this.projects.set(project.id, project);
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
    this.requireRole(userId, project.workspaceId, "editor");
    const key = `${projectId}:${mutation.mutationId}`;
    const replay = this.mutations.get(key);
    if (replay) return { ...replay, replayed: true };
    if (mutation.baseRevision !== project.document.revision)
      throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
    const document = applyCanvasOperations(
      project.document,
      mutation.operations,
    );
    const next = { ...project, document, updatedAt: document.updatedAt };
    const result = { project: next, replayed: false };
    this.projects.set(projectId, next);
    this.mutations.set(key, result);
    return result;
  }
  private memberKey(workspaceId: string, userId: string) {
    return `${workspaceId}:${userId}`;
  }
  private requireRole(
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
