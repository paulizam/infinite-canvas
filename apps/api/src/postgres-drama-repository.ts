import pg, { type PoolClient } from "pg";
import { DomainError } from "./domain.js";
import type {
  DramaDetail,
  DramaEntity,
  DramaMutation,
  DramaProject,
  DramaRepository,
  DramaScriptVersion,
  DramaShot,
} from "./drama-repository.js";

export class PostgresDramaRepository implements DramaRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async list(userId: string, workspaceId: string) {
    await role(this.pool, userId, workspaceId, "viewer");
    const r = await this.pool.query(
      "SELECT * FROM drama_projects WHERE workspace_id=$1 ORDER BY updated_at DESC",
      [workspaceId],
    );
    return r.rows.map(project);
  }
  async get(userId: string, id: string) {
    const r = await this.pool.query(
      "SELECT p.* FROM drama_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id WHERE p.id=$1 AND m.user_id=$2",
      [id, userId],
    );
    return r.rows[0] ? detail(this.pool, project(r.rows[0])) : null;
  }
  async create(userId: string, p: DramaProject, s: DramaScriptVersion | null) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await role(c, userId, p.workspaceId, "editor");
      await c.query(
        "INSERT INTO drama_projects(id,workspace_id,owner_id,title,source_text,source_asset_id,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,0,$7,$7)",
        [
          p.id,
          p.workspaceId,
          p.ownerId,
          p.title,
          p.sourceText,
          p.sourceAssetId,
          p.createdAt,
        ],
      );
      if (s) await insertScript(c, s);
      await c.query("COMMIT");
      return detail(c, p);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async mutate(
    userId: string,
    id: string,
    expected: number,
    mutationId: string,
    hash: string,
    m: DramaMutation,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT * FROM drama_projects WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!q.rows[0])
        throw new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
      const p = project(q.rows[0]);
      await role(c, userId, p.workspaceId, "editor");
      const old = await c.query(
        "SELECT request_hash FROM drama_mutations WHERE project_id=$1 AND mutation_id=$2",
        [id, mutationId],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash)
          throw new DomainError(
            "DRAMA_IDEMPOTENCY_CONFLICT",
            409,
            "幂等键内容漂移",
          );
        await c.query("COMMIT");
        return { detail: await detail(c, p), replayed: true };
      }
      if (p.revision !== expected)
        throw new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
      if (m.type === "project")
        await c.query(
          "UPDATE drama_projects SET title=$2,source_text=$3,source_asset_id=$4 WHERE id=$1",
          [id, m.title, m.sourceText, m.sourceAssetId],
        );
      else if (m.type === "script") await insertScript(c, m.record);
      else if (m.type === "entity")
        await c.query(
          "INSERT INTO drama_entities(id,project_id,workspace_id,kind,name,description,prompt,reference_asset_id,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
          [
            m.record.id,
            id,
            p.workspaceId,
            m.record.kind,
            m.record.name,
            m.record.description,
            m.record.prompt,
            m.record.referenceAssetId,
            m.record.sortOrder,
            m.record.createdAt,
          ],
        );
      else {
        const x = m.record;
        await c.query(
          "INSERT INTO drama_shots(id,project_id,workspace_id,title,prompt,framing,camera_movement,duration_ms,sort_order,current_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$10)",
          [
            x.id,
            id,
            p.workspaceId,
            x.title,
            x.prompt,
            x.framing,
            x.cameraMovement,
            x.durationMs,
            x.sortOrder,
            x.createdAt,
          ],
        );
        await c.query(
          "INSERT INTO drama_shot_versions(id,shot_id,version,snapshot,created_by,created_at) VALUES(gen_random_uuid(),$1,1,$2::jsonb,$3,$4)",
          [x.id, JSON.stringify(x), userId, x.createdAt],
        );
      }
      const now = new Date().toISOString();
      await c.query(
        "UPDATE drama_projects SET revision=revision+1,updated_at=$2 WHERE id=$1",
        [id, now],
      );
      await c.query(
        "INSERT INTO drama_mutations(project_id,mutation_id,request_hash,resulting_revision,created_at) VALUES($1,$2,$3,$4,$5)",
        [id, mutationId, hash, expected + 1, now],
      );
      await c.query("COMMIT");
      return {
        detail: await detail(c, {
          ...p,
          revision: expected + 1,
          updatedAt: now,
        }),
        replayed: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
type Db = {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }>;
};
async function role(
  db: Db,
  userId: string,
  workspaceId: string,
  minimum: "viewer" | "editor",
) {
  const roles = { viewer: 0, editor: 1, admin: 2, owner: 3 };
  const r = await db.query(
    "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    [workspaceId, userId],
  );
  if (
    !r.rows[0] ||
    roles[r.rows[0].role as keyof typeof roles] < roles[minimum]
  )
    throw new DomainError("FORBIDDEN", 403, "空间权限不足");
}
async function detail(db: Db, p: DramaProject): Promise<DramaDetail> {
  const [s, e, h] = await Promise.all([
    db.query(
      "SELECT * FROM drama_script_versions WHERE project_id=$1 ORDER BY version DESC",
      [p.id],
    ),
    db.query(
      "SELECT * FROM drama_entities WHERE project_id=$1 ORDER BY sort_order,id",
      [p.id],
    ),
    db.query(
      "SELECT * FROM drama_shots WHERE project_id=$1 ORDER BY sort_order,id",
      [p.id],
    ),
  ]);
  return {
    project: p,
    scripts: s.rows.map(script),
    entities: e.rows.map(entity),
    shots: h.rows.map(shot),
  };
}
async function insertScript(c: PoolClient, s: DramaScriptVersion) {
  await c.query(
    "INSERT INTO drama_script_versions(id,project_id,workspace_id,version,content,segments,analysis,review_status,operation,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)",
    [
      s.id,
      s.projectId,
      s.workspaceId,
      s.version,
      s.content,
      JSON.stringify(s.segments),
      JSON.stringify(s.analysis),
      s.reviewStatus,
      s.operation,
      s.createdBy,
      s.createdAt,
    ],
  );
}
const project = (r: any): DramaProject => ({
  id: r.id,
  workspaceId: r.workspace_id,
  ownerId: r.owner_id,
  title: r.title,
  sourceText: r.source_text,
  sourceAssetId: r.source_asset_id,
  revision: r.revision,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
const script = (r: any): DramaScriptVersion => ({
  id: r.id,
  projectId: r.project_id,
  workspaceId: r.workspace_id,
  version: r.version,
  content: r.content,
  segments: r.segments,
  analysis: r.analysis,
  reviewStatus: r.review_status,
  operation: r.operation,
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).toISOString(),
});
const entity = (r: any): DramaEntity => ({
  id: r.id,
  projectId: r.project_id,
  workspaceId: r.workspace_id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  prompt: r.prompt,
  referenceAssetId: r.reference_asset_id,
  sortOrder: r.sort_order,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
const shot = (r: any): DramaShot => ({
  id: r.id,
  projectId: r.project_id,
  workspaceId: r.workspace_id,
  title: r.title,
  prompt: r.prompt,
  framing: r.framing,
  cameraMovement: r.camera_movement,
  durationMs: r.duration_ms,
  sortOrder: r.sort_order,
  currentVersion: r.current_version,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
