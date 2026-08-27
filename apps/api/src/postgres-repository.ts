import pg from "pg";
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

export class PostgresPlatformRepository implements PlatformRepository {
  private pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async createUserWithWorkspace({
    user,
    workspace,
    membership,
  }: {
    user: UserRecord;
    workspace: WorkspaceRecord;
    membership: MembershipRecord;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users(id,email,name,password_hash,created_at) VALUES($1,$2,$3,$4,$5)",
        [user.id, user.email, user.name, user.passwordHash, user.createdAt],
      );
      await client.query(
        "INSERT INTO workspaces(id,name,created_at) VALUES($1,$2,$3)",
        [workspace.id, workspace.name, workspace.createdAt],
      );
      await client.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)",
        [membership.workspaceId, membership.userId, membership.role],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new DomainError("EMAIL_EXISTS", 409, "邮箱已注册");
      throw error;
    } finally {
      client.release();
    }
  }
  async findUserByEmail(email: string) {
    const r = await this.pool.query("SELECT * FROM users WHERE email=$1", [
      email,
    ]);
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  }
  async findUserById(id: string) {
    const r = await this.pool.query("SELECT * FROM users WHERE id=$1", [id]);
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  }
  async createSession(s: SessionRecord) {
    await this.pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [s.tokenHash, s.userId, s.expiresAt],
    );
  }
  async findSession(hash: string, now: string) {
    const r = await this.pool.query(
      "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>$2",
      [hash, now],
    );
    return r.rows[0]
      ? {
          tokenHash: r.rows[0].token_hash,
          userId: r.rows[0].user_id,
          expiresAt: iso(r.rows[0].expires_at),
        }
      : null;
  }
  async deleteSession(hash: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash=$1", [hash]);
  }
  async listWorkspaces(userId: string) {
    const r = await this.pool.query(
      "SELECT w.*,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at",
      [userId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: iso(row.created_at),
      role: row.role as WorkspaceRole,
    }));
  }
  async createWorkspace(w: WorkspaceRecord, m: MembershipRecord) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO workspaces(id,name,created_at) VALUES($1,$2,$3)",
        [w.id, w.name, w.createdAt],
      );
      await c.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)",
        [m.workspaceId, m.userId, m.role],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async listProjects(userId: string, workspaceId: string) {
    await this.requireRole(this.pool, userId, workspaceId, "viewer");
    const r = await this.pool.query(
      "SELECT * FROM canvas_projects WHERE workspace_id=$1 ORDER BY updated_at DESC",
      [workspaceId],
    );
    return r.rows.map(mapProject);
  }
  async createProject(userId: string, p: ProjectRecord) {
    await this.requireRole(this.pool, userId, p.workspaceId, "editor");
    await this.pool.query(
      "INSERT INTO canvas_projects(id,workspace_id,owner_id,document,revision,created_at,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)",
      [
        p.id,
        p.workspaceId,
        p.ownerId,
        JSON.stringify(p.document),
        p.document.revision,
        p.createdAt,
        p.updatedAt,
      ],
    );
  }
  async getProject(userId: string, id: string) {
    const r = await this.pool.query(
      "SELECT p.* FROM canvas_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id WHERE p.id=$1 AND m.user_id=$2",
      [id, userId],
    );
    return r.rows[0] ? mapProject(r.rows[0]) : null;
  }
  async applyProjectMutation(
    userId: string,
    projectId: string,
    mutation: CanvasMutation,
  ): Promise<MutationResult> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const p = await c.query(
        "SELECT * FROM canvas_projects WHERE id=$1 FOR UPDATE",
        [projectId],
      );
      if (!p.rows[0])
        throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
      await this.requireRole(c, userId, p.rows[0].workspace_id, "editor");
      const replay = await c.query(
        "SELECT revision FROM canvas_project_mutations WHERE project_id=$1 AND mutation_id=$2",
        [projectId, mutation.mutationId],
      );
      if (replay.rows[0]) {
        await c.query("COMMIT");
        return { project: mapProject(p.rows[0]), replayed: true };
      }
      if (p.rows[0].revision !== mutation.baseRevision)
        throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
      const current = mapProject(p.rows[0]);
      const document = applyCanvasOperations(
        current.document,
        mutation.operations,
      );
      await c.query(
        "UPDATE canvas_projects SET document=$2::jsonb,revision=$3,updated_at=$4 WHERE id=$1",
        [
          projectId,
          JSON.stringify(document),
          document.revision,
          document.updatedAt,
        ],
      );
      await c.query(
        "INSERT INTO canvas_project_mutations(project_id,mutation_id,revision,created_at) VALUES($1,$2,$3,$4)",
        [projectId, mutation.mutationId, document.revision, mutation.createdAt],
      );
      await c.query("COMMIT");
      return {
        project: { ...current, document, updatedAt: document.updatedAt },
        replayed: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private async requireRole(
    client: Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">,
    userId: string,
    workspaceId: string,
    minimum: WorkspaceRole,
  ) {
    const r = await client.query(
      "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
      [workspaceId, userId],
    );
    const rank: Record<WorkspaceRole, number> = {
      viewer: 0,
      editor: 1,
      admin: 2,
      owner: 3,
    };
    const role = r.rows[0]?.role as WorkspaceRole | undefined;
    if (!role || rank[role] < rank[minimum])
      throw new DomainError("FORBIDDEN", 403, "权限不足");
  }
}
function mapUser(r: Record<string, unknown>): UserRecord {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    passwordHash: String(r.password_hash),
    createdAt: iso(r.created_at),
  };
}
function mapProject(r: Record<string, unknown>): ProjectRecord {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    ownerId: String(r.owner_id),
    document: r.document as ProjectRecord["document"],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function iso(v: unknown) {
  return v instanceof Date ? v.toISOString() : String(v);
}
