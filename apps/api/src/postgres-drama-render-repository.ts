import pg from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  DramaRenderJob,
  DramaRenderRepository,
  DramaRenderVersion,
  RenderStatus,
} from "./drama-render-repository.js";
export class PostgresDramaRenderRepository implements DramaRenderRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async list(userId: string, id: string) {
    const p = await this.pool.query(
      "SELECT 1 FROM drama_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id WHERE p.id=$1 AND m.user_id=$2",
      [id, userId],
    );
    if (!p.rows[0])
      throw new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
    const [j, v] = await Promise.all([
      this.pool.query(
        "SELECT * FROM drama_render_jobs WHERE project_id=$1 ORDER BY created_at DESC",
        [id],
      ),
      this.pool.query(
        "SELECT * FROM drama_render_versions WHERE project_id=$1 ORDER BY kind,version DESC",
        [id],
      ),
    ]);
    return { jobs: j.rows.map(job), versions: v.rows.map(version) };
  }
  async create(
    userId: string,
    expected: number,
    hash: string,
    x: DramaRenderJob,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const p = await c.query(
        "SELECT p.revision,m.role FROM drama_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id AND m.user_id=$2 WHERE p.id=$1 FOR UPDATE OF p",
        [x.projectId, userId],
      );
      if (!p.rows[0])
        throw new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
      if (!["owner", "admin", "editor"].includes(p.rows[0].role))
        throw new DomainError("FORBIDDEN", 403, "空间权限不足");
      const old = await c.query(
        "SELECT * FROM drama_render_jobs WHERE project_id=$1 AND mutation_id=$2",
        [x.projectId, x.mutationId],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash)
          throw new DomainError(
            "DRAMA_IDEMPOTENCY_CONFLICT",
            409,
            "幂等键内容漂移",
          );
        await c.query("COMMIT");
        return { job: job(old.rows[0]), replayed: true };
      }
      if (p.rows[0].revision !== expected)
        throw new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
      await c.query(
        "INSERT INTO drama_render_jobs(id,project_id,workspace_id,owner_id,kind,status,progress,attempt,retry_of,input,output_asset_id,error_code,error_message,worker_id,lease_until,mutation_id,request_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'queued',0,1,NULL,$6::jsonb,NULL,NULL,NULL,NULL,NULL,$7,$8,$9,$9)",
        [
          x.id,
          x.projectId,
          x.workspaceId,
          x.ownerId,
          x.kind,
          JSON.stringify(x.input),
          x.mutationId,
          hash,
          x.createdAt,
        ],
      );
      await c.query(
        "UPDATE drama_projects SET revision=revision+1,updated_at=$2 WHERE id=$1",
        [x.projectId, x.createdAt],
      );
      await c.query("COMMIT");
      return { job: x, replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async retry(
    userId: string,
    id: string,
    newId: string,
    mutationId: string,
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT j.*,m.role FROM drama_render_jobs j JOIN workspace_members m ON m.workspace_id=j.workspace_id AND m.user_id=$2 WHERE j.id=$1 FOR UPDATE OF j",
        [id, userId],
      );
      if (!q.rows[0])
        throw new DomainError("DRAMA_RENDER_NOT_FOUND", 404, "渲染任务不存在");
      if (!["owner", "admin", "editor"].includes(q.rows[0].role))
        throw new DomainError("FORBIDDEN", 403, "空间权限不足");
      if (!["failed", "cancelled"].includes(q.rows[0].status))
        throw new DomainError(
          "DRAMA_RENDER_NOT_RETRYABLE",
          409,
          "仅失败或取消任务可重试",
        );
      const x = job(q.rows[0]);
      await c.query(
        "INSERT INTO drama_render_jobs(id,project_id,workspace_id,owner_id,kind,status,progress,attempt,retry_of,input,mutation_id,request_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7,$8::jsonb,$9,$10,$11,$11)",
        [
          newId,
          x.projectId,
          x.workspaceId,
          x.ownerId,
          x.kind,
          x.attempt + 1,
          x.id,
          JSON.stringify(x.input),
          mutationId,
          randomUUID().replaceAll("-", "").padEnd(64, "0"),
          now,
        ],
      );
      await c.query("COMMIT");
      return {
        ...x,
        id: newId,
        status: "queued" as const,
        progress: 0,
        attempt: x.attempt + 1,
        retryOf: x.id,
        mutationId,
        createdAt: now,
        updatedAt: now,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async claim(
    workerId: string,
    limit: number,
    now: string,
    leaseUntil: string,
  ) {
    const r = await this.pool.query(
      `WITH c AS (SELECT id FROM drama_render_jobs WHERE status='queued' OR (status='running' AND lease_until<$2) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE drama_render_jobs j SET status='running',worker_id=$3,lease_until=$4,updated_at=$2 FROM c WHERE j.id=c.id RETURNING j.*`,
      [limit, now, workerId, leaseUntil],
    );
    return r.rows.map(job);
  }
  async heartbeat(w: string, ids: string[], lease: string) {
    const r = await this.pool.query(
      "UPDATE drama_render_jobs SET lease_until=$3 WHERE worker_id=$1 AND id=ANY($2::uuid[]) AND status='running'",
      [w, ids, lease],
    );
    return r.rowCount || 0;
  }
  async transition(
    w: string,
    id: string,
    status: RenderStatus,
    p: any,
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT * FROM drama_render_jobs WHERE id=$1 AND worker_id=$2 AND status='running' FOR UPDATE",
        [id, w],
      );
      if (!q.rows[0])
        throw new DomainError("DRAMA_RENDER_LEASE_LOST", 409, "渲染租约已失效");
      const x = job(q.rows[0]);
      await c.query(
        "UPDATE drama_render_jobs SET status=$3,progress=COALESCE($4,progress),output_asset_id=COALESCE($5,output_asset_id),error_code=$6,error_message=$7,worker_id=CASE WHEN $3 IN ('succeeded','failed','cancelled') THEN NULL ELSE worker_id END,lease_until=CASE WHEN $3 IN ('succeeded','failed','cancelled') THEN NULL ELSE lease_until END,updated_at=$8 WHERE id=$1 AND worker_id=$2",
        [
          id,
          w,
          status,
          p.progress ?? null,
          p.outputAssetId ?? null,
          p.errorCode ?? null,
          p.errorMessage ?? null,
          now,
        ],
      );
      if (status === "succeeded" && p.outputAssetId) {
        const v = await c.query(
          "SELECT COALESCE(MAX(version),0)+1 n FROM drama_render_versions WHERE project_id=$1 AND kind=$2",
          [x.projectId, x.kind],
        );
        await c.query(
          "INSERT INTO drama_render_versions(id,project_id,workspace_id,render_job_id,version,kind,asset_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            x.projectId,
            x.workspaceId,
            x.id,
            v.rows[0].n,
            x.kind,
            p.outputAssetId,
            x.ownerId,
            now,
          ],
        );
      }
      await c.query("COMMIT");
      return {
        ...x,
        ...p,
        status,
        updatedAt: now,
        workerId: ["succeeded", "failed", "cancelled"].includes(status)
          ? null
          : w,
        leaseUntil: ["succeeded", "failed", "cancelled"].includes(status)
          ? null
          : x.leaseUntil,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
const iso = (x: any) => (x ? new Date(x).toISOString() : null);
const job = (x: any): DramaRenderJob => ({
  id: x.id,
  projectId: x.project_id,
  workspaceId: x.workspace_id,
  ownerId: x.owner_id,
  kind: x.kind,
  status: x.status,
  progress: x.progress,
  attempt: x.attempt,
  retryOf: x.retry_of,
  input: x.input,
  outputAssetId: x.output_asset_id,
  errorCode: x.error_code,
  errorMessage: x.error_message,
  workerId: x.worker_id,
  leaseUntil: iso(x.lease_until),
  mutationId: x.mutation_id,
  createdAt: iso(x.created_at)!,
  updatedAt: iso(x.updated_at)!,
});
const version = (x: any): DramaRenderVersion => ({
  id: x.id,
  projectId: x.project_id,
  workspaceId: x.workspace_id,
  renderJobId: x.render_job_id,
  version: x.version,
  kind: x.kind,
  assetId: x.asset_id,
  createdBy: x.created_by,
  createdAt: iso(x.created_at)!,
});
