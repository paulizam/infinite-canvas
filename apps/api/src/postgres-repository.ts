import pg from "pg";
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

export class PostgresPlatformRepository implements PlatformRepository {
  private pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    minimum: WorkspaceRole,
  ) {
    return this.requireWorkspaceRoleWithClient(
      this.pool,
      userId,
      workspaceId,
      minimum,
    );
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
    const r = await this.pool.query(
      "SELECT * FROM users WHERE email=$1 AND status='active'",
      [email],
    );
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  }
  async findUserById(id: string) {
    const r = await this.pool.query(
      "SELECT * FROM users WHERE id=$1 AND status='active'",
      [id],
    );
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
      "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>$2 AND revoked_at IS NULL",
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
    await this.requireWorkspaceRoleWithClient(
      this.pool,
      userId,
      workspaceId,
      "viewer",
    );
    const r = await this.pool.query(
      "SELECT * FROM canvas_projects WHERE workspace_id=$1 ORDER BY updated_at DESC",
      [workspaceId],
    );
    return r.rows.map(mapProject);
  }
  async createProject(userId: string, p: ProjectRecord) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.requireWorkspaceRoleWithClient(
        client,
        userId,
        p.workspaceId,
        "editor",
      );
      await client.query(
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
      await syncAssetReferences(client, p.id, p.document);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async deleteProject(userId: string, id: string) {
    const project = await this.getProject(userId, id);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.requireWorkspaceRoleWithClient(
      this.pool,
      userId,
      project.workspaceId,
      "editor",
    );
    await this.pool.query("DELETE FROM canvas_projects WHERE id=$1", [id]);
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
      await this.requireWorkspaceRoleWithClient(
        c,
        userId,
        p.rows[0].workspace_id,
        "editor",
      );
      const { createdAt: _, ...semanticMutation } = mutation;
      const requestHash = createHash("sha256")
        .update(JSON.stringify(semanticMutation))
        .digest("hex");
      const replay = await c.query(
        "SELECT revision,request_hash FROM canvas_project_mutations WHERE project_id=$1 AND mutation_id=$2",
        [projectId, mutation.mutationId],
      );
      if (replay.rows[0]) {
        if (
          replay.rows[0].request_hash &&
          replay.rows[0].request_hash !== requestHash
        )
          throw new DomainError(
            "MUTATION_IDEMPOTENCY_CONFLICT",
            409,
            "Mutation 幂等键内容漂移",
          );
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
        "INSERT INTO canvas_project_mutations(project_id,mutation_id,revision,created_at,request_hash) VALUES($1,$2,$3,$4,$5)",
        [
          projectId,
          mutation.mutationId,
          document.revision,
          mutation.createdAt,
          requestHash,
        ],
      );
      await syncAssetReferences(c, projectId, document);
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
  async listProjectCheckpoints(userId: string, projectId: string) {
    const result = await this.pool.query(
      `SELECT c.* FROM canvas_project_checkpoints c
       JOIN workspace_members m ON m.workspace_id=c.workspace_id
       WHERE c.project_id=$1 AND m.user_id=$2 ORDER BY c.created_at DESC`,
      [projectId, userId],
    );
    if (!result.rows.length && !(await this.getProject(userId, projectId)))
      throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    return result.rows.map(mapCheckpoint);
  }
  async getProjectCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
  ) {
    const result = await this.pool.query(
      `SELECT c.* FROM canvas_project_checkpoints c
       JOIN workspace_members m ON m.workspace_id=c.workspace_id
       WHERE c.id=$1 AND c.project_id=$2 AND m.user_id=$3`,
      [checkpointId, projectId, userId],
    );
    return result.rows[0] ? mapCheckpoint(result.rows[0]) : null;
  }
  async createProjectCheckpoint(
    userId: string,
    projectId: string,
    input: Pick<
      ProjectCheckpointRecord,
      "id" | "name" | "description" | "createdBy" | "createdAt"
    >,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM canvas_projects WHERE id=$1 FOR UPDATE",
        [projectId],
      );
      if (!result.rows[0])
        throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
      await this.requireWorkspaceRoleWithClient(
        client,
        userId,
        result.rows[0].workspace_id,
        "editor",
      );
      const project = mapProject(result.rows[0]);
      const inserted = await client.query(
        `INSERT INTO canvas_project_checkpoints(id,project_id,workspace_id,name,description,source_revision,snapshot,created_by,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
        [
          input.id,
          projectId,
          project.workspaceId,
          input.name,
          input.description,
          project.document.revision,
          JSON.stringify(project.document),
          input.createdBy,
          input.createdAt,
        ],
      );
      await client.query("COMMIT");
      return mapCheckpoint(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async deleteProjectCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const project = await client.query(
        "SELECT workspace_id FROM canvas_projects WHERE id=$1 FOR UPDATE",
        [projectId],
      );
      if (!project.rows[0])
        throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
      await this.requireWorkspaceRoleWithClient(
        client,
        userId,
        project.rows[0].workspace_id,
        "editor",
      );
      const removed = await client.query(
        "DELETE FROM canvas_project_checkpoints WHERE id=$1 AND project_id=$2 RETURNING id",
        [checkpointId, projectId],
      );
      if (!removed.rows[0])
        throw new DomainError("CHECKPOINT_NOT_FOUND", 404, "Checkpoint 不存在");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async restoreProjectCheckpoint(
    userId: string,
    projectId: string,
    checkpointId: string,
    expectedRevision: number,
    restoredAt: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM canvas_projects WHERE id=$1 FOR UPDATE",
        [projectId],
      );
      if (!result.rows[0])
        throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
      await this.requireWorkspaceRoleWithClient(
        client,
        userId,
        result.rows[0].workspace_id,
        "editor",
      );
      const project = mapProject(result.rows[0]);
      if (project.document.revision !== expectedRevision)
        throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
      const checkpointResult = await client.query(
        "SELECT * FROM canvas_project_checkpoints WHERE id=$1 AND project_id=$2",
        [checkpointId, projectId],
      );
      if (!checkpointResult.rows[0])
        throw new DomainError("CHECKPOINT_NOT_FOUND", 404, "Checkpoint 不存在");
      const checkpoint = mapCheckpoint(checkpointResult.rows[0]);
      const document = {
        ...checkpoint.snapshot,
        id: projectId,
        revision: expectedRevision + 1,
        updatedAt: restoredAt,
      };
      await client.query(
        "UPDATE canvas_projects SET document=$2::jsonb,revision=$3,updated_at=$4 WHERE id=$1",
        [projectId, JSON.stringify(document), document.revision, restoredAt],
      );
      await syncAssetReferences(client, projectId, document);
      await client.query("COMMIT");
      return { ...project, document, updatedAt: restoredAt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async findAssetByHash(userId: string, workspaceId: string, sha256: string) {
    await this.requireWorkspaceRoleWithClient(
      this.pool,
      userId,
      workspaceId,
      "viewer",
    );
    const result = await this.pool.query(
      "SELECT * FROM media_assets WHERE workspace_id=$1 AND sha256=$2",
      [workspaceId, sha256],
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }
  async createAsset(userId: string, asset: AssetRecord) {
    await this.requireWorkspaceRoleWithClient(
      this.pool,
      userId,
      asset.workspaceId,
      "editor",
    );
    const result = await this.pool.query(
      "INSERT INTO media_assets(id,workspace_id,owner_id,storage_key,sha256,bytes,mime_type,kind,original_name,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING *",
      [
        asset.id,
        asset.workspaceId,
        asset.ownerId,
        asset.storageKey,
        asset.sha256,
        asset.bytes,
        asset.mimeType,
        asset.kind,
        asset.originalName,
        asset.createdAt,
      ],
    );
    return mapAsset(result.rows[0]);
  }
  async getAsset(userId: string, assetId: string) {
    const result = await this.pool.query(
      "SELECT a.* FROM media_assets a JOIN workspace_members m ON m.workspace_id=a.workspace_id WHERE a.id=$1 AND m.user_id=$2",
      [assetId, userId],
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }
  async listAssets(userId: string, workspaceId: string) {
    await this.requireWorkspaceRoleWithClient(
      this.pool,
      userId,
      workspaceId,
      "viewer",
    );
    const result = await this.pool.query(
      "SELECT * FROM media_assets WHERE workspace_id=$1 ORDER BY created_at DESC",
      [workspaceId],
    );
    return result.rows.map(mapAsset);
  }
  async deleteAsset(userId: string, assetId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM media_assets WHERE id=$1 FOR UPDATE",
        [assetId],
      );
      if (!result.rows[0])
        throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
      const asset = mapAsset(result.rows[0]);
      await this.requireWorkspaceRoleWithClient(
        client,
        userId,
        asset.workspaceId,
        "editor",
      );
      const references = await client.query(
        "SELECT 1 FROM media_asset_references WHERE asset_id=$1 LIMIT 1",
        [assetId],
      );
      if (references.rows[0])
        throw new DomainError("ASSET_IN_USE", 409, "素材仍被项目引用");
      await client.query("DELETE FROM media_assets WHERE id=$1", [assetId]);
      await client.query("COMMIT");
      return asset;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async requireWorkspaceRoleWithClient(
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
function mapAsset(r: Record<string, unknown>): AssetRecord {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    ownerId: String(r.owner_id),
    storageKey: String(r.storage_key),
    sha256: String(r.sha256),
    bytes: Number(r.bytes),
    mimeType: String(r.mime_type),
    kind: r.kind as AssetRecord["kind"],
    originalName: String(r.original_name),
    createdAt: iso(r.created_at),
  };
}
function mapCheckpoint(r: Record<string, unknown>): ProjectCheckpointRecord {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    description: String(r.description || ""),
    sourceRevision: Number(r.source_revision),
    snapshot: r.snapshot as ProjectCheckpointRecord["snapshot"],
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}
async function syncAssetReferences(
  client: Pick<pg.PoolClient, "query">,
  projectId: string,
  document: unknown,
) {
  const ids = [...extractAssetIds(document)].filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ),
  );
  await client.query("DELETE FROM media_asset_references WHERE project_id=$1", [
    projectId,
  ]);
  if (ids.length)
    await client.query(
      "INSERT INTO media_asset_references(asset_id,project_id) SELECT id,$1 FROM media_assets WHERE id=ANY($2::uuid[]) ON CONFLICT DO NOTHING",
      [projectId, ids],
    );
}
function iso(v: unknown) {
  return v instanceof Date ? v.toISOString() : String(v);
}
