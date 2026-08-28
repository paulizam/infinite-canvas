import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CANVAS_SCHEMA_VERSION,
  type CanvasDocument,
  type CanvasMutation,
} from "@infinite-canvas/contracts";
import {
  DomainError,
  publicUser,
  type PlatformRepository,
  type ProjectRecord,
  type WorkspaceRecord,
} from "./domain.js";

export class IdentityService {
  constructor(
    private repository: PlatformRepository,
    private sessionTtlMs: number,
  ) {
    if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0)
      throw new Error("SESSION_TTL_SECONDS 必须显式配置为正数");
  }
  async register(input: { email: string; password: string; name: string }) {
    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: await hash(input.password),
      createdAt: now,
    };
    const workspace = {
      id: randomUUID(),
      name: `${user.name}的空间`,
      createdAt: now,
    };
    await this.repository.createUserWithWorkspace({
      user,
      workspace,
      membership: { workspaceId: workspace.id, userId: user.id, role: "owner" },
    });
    return {
      user: publicUser(user),
      workspace,
      token: await this.issueSession(user.id),
    };
  }
  async login(email: string, password: string) {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    if (!user || !(await verify(user.passwordHash, password)))
      throw new DomainError("INVALID_CREDENTIALS", 401, "邮箱或密码错误");
    return { user: publicUser(user), token: await this.issueSession(user.id) };
  }
  async authenticate(token: string | undefined) {
    if (!token) throw new DomainError("UNAUTHENTICATED", 401, "请先登录");
    const session = await this.repository.findSession(
      tokenHash(token),
      new Date().toISOString(),
    );
    if (!session)
      throw new DomainError("UNAUTHENTICATED", 401, "登录状态已失效");
    const user = await this.repository.findUserById(session.userId);
    if (!user) throw new DomainError("UNAUTHENTICATED", 401, "用户不存在");
    return publicUser(user);
  }
  async logout(token: string | undefined) {
    if (token) await this.repository.deleteSession(tokenHash(token));
  }
  async verifyPassword(userId: string, password: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !(await verify(user.passwordHash, password)))
      throw new DomainError("INVALID_CREDENTIALS", 401, "密码验证失败");
  }
  private async issueSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.repository.createSession({
      tokenHash: tokenHash(token),
      userId,
      expiresAt: new Date(Date.now() + this.sessionTtlMs).toISOString(),
    });
    return token;
  }
}

export class WorkspaceService {
  constructor(private repository: PlatformRepository) {}
  list(userId: string) {
    return this.repository.listWorkspaces(userId);
  }
  async create(userId: string, name: string) {
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    await this.repository.createWorkspace(workspace, {
      workspaceId: workspace.id,
      userId,
      role: "owner",
    });
    return workspace;
  }
}

export class ProjectService {
  constructor(private repository: PlatformRepository) {}
  list(userId: string, workspaceId: string) {
    return this.repository.listProjects(userId, workspaceId);
  }
  get(userId: string, projectId: string) {
    return this.repository.getProject(userId, projectId);
  }
  delete(userId: string, projectId: string) {
    return this.repository.deleteProject(userId, projectId);
  }
  async create(
    userId: string,
    workspaceId: string,
    input: { title: string; projectId?: string; document?: CanvasDocument },
  ): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const id = input.projectId || input.document?.id || randomUUID();
    if (input.document && input.document.id !== id)
      throw new DomainError("PROJECT_MISMATCH", 400, "项目标识不匹配");
    const document: CanvasDocument = input.document
      ? {
          ...input.document,
          id,
          revision: 0,
          title: input.title.trim(),
          updatedAt: now,
        }
      : {
          id,
          schemaVersion: CANVAS_SCHEMA_VERSION,
          revision: 0,
          title: input.title.trim(),
          createdAt: now,
          updatedAt: now,
          nodes: [],
          connections: [],
          chatSessions: [],
          activeChatId: null,
          backgroundMode: "lines",
          showImageInfo: false,
          viewport: { x: 0, y: 0, k: 1 },
        };
    const project = {
      id,
      workspaceId,
      ownerId: userId,
      document,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createProject(userId, project);
    return project;
  }
  mutate(userId: string, projectId: string, mutation: CanvasMutation) {
    if (mutation.projectId !== projectId)
      throw new DomainError("PROJECT_MISMATCH", 400, "项目标识不匹配");
    return this.repository.applyProjectMutation(userId, projectId, mutation);
  }
  listCheckpoints(userId: string, projectId: string) {
    return this.repository.listProjectCheckpoints(userId, projectId);
  }
  async getCheckpoint(userId: string, projectId: string, checkpointId: string) {
    const checkpoint = await this.repository.getProjectCheckpoint(
      userId,
      projectId,
      checkpointId,
    );
    if (!checkpoint)
      throw new DomainError("CHECKPOINT_NOT_FOUND", 404, "Checkpoint 不存在");
    return checkpoint;
  }
  createCheckpoint(
    userId: string,
    projectId: string,
    input: { name: string; description?: string },
  ) {
    return this.repository.createProjectCheckpoint(userId, projectId, {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || "",
      createdBy: userId,
      createdAt: new Date().toISOString(),
    });
  }
  deleteCheckpoint(userId: string, projectId: string, checkpointId: string) {
    return this.repository.deleteProjectCheckpoint(
      userId,
      projectId,
      checkpointId,
    );
  }
  restoreCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
    expectedRevision: number,
  ) {
    return this.repository.restoreProjectCheckpoint(
      userId,
      projectId,
      checkpointId,
      expectedRevision,
      new Date().toISOString(),
    );
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
