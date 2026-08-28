import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  AdminActor,
  AdminRepository,
  AdminSetting,
} from "./admin-repository.js";

export class PostgresAdminRepository implements AdminRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async isAdmin(userId: string) {
    return !!(
      await this.pool.query(
        "SELECT 1 FROM users WHERE id=$1 AND status='active' AND platform_role='admin'",
        [userId],
      )
    ).rows[0];
  }
  async recordAudit(
    actor: AdminActor,
    action: string,
    resourceType: string,
    resourceId: string,
    details: unknown = {},
  ) {
    await audit(this.pool, actor, action, resourceType, resourceId, details);
  }
  async dashboard() {
    const [users, jobs, assets, billing, health, governance] =
      await Promise.all([
        this.pool.query(
          "SELECT count(*)::int total,count(*) FILTER (WHERE status='active')::int active,count(*) FILTER (WHERE status='suspended')::int suspended FROM users",
        ),
        this.pool.query(
          "SELECT count(*)::int total,count(*) FILTER (WHERE status='queued')::int queued,count(*) FILTER (WHERE status='running')::int running,count(*) FILTER (WHERE status='failed')::int failed,count(*) FILTER (WHERE status='needs_review')::int needs_review FROM generation_jobs",
        ),
        this.pool.query(
          "SELECT count(*)::int total,COALESCE(sum(bytes),0)::text bytes FROM media_assets",
        ),
        this.pool.query(
          "SELECT COALESCE(sum(balance_units),0)::text wallet_units,(SELECT count(*)::int FROM billing_orders) orders,(SELECT COALESCE(sum(amount_minor),0)::text FROM billing_orders WHERE status IN ('fulfilled','refund_pending','refunded','refund_failed','needs_review')) revenue_minor",
        ),
        this.pool.query(
          "SELECT max(last_seen_at) last_worker_heartbeat,(SELECT count(*)::int FROM upstream_models WHERE health_state<>'healthy') degraded_models FROM generation_worker_heartbeats",
        ),
        this.pool.query(
          "SELECT count(*) FILTER (WHERE status='pending')::int pending_works,(SELECT count(*)::int FROM community_reports WHERE status='open') open_reports FROM community_works",
        ),
      ]);
    return {
      users: users.rows[0],
      jobs: jobs.rows[0],
      assets: numeric(assets.rows[0]),
      billing: numeric(billing.rows[0]),
      health: health.rows[0],
      governance: governance.rows[0],
      generatedAt: new Date().toISOString(),
    };
  }
  async users(q: string | undefined, limit: number, cursor?: string) {
    const r = await this.pool.query(
      `SELECT u.id,u.email,u.name,u.status,u.platform_role,u.created_at,u.updated_at,
       COALESCE(w.balance_units,0) balance_units,
       count(DISTINCT s.token_hash) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at>now())::int active_sessions,
       count(DISTINCT wm.workspace_id)::int workspaces
       FROM users u LEFT JOIN billing_wallets w ON w.user_id=u.id LEFT JOIN sessions s ON s.user_id=u.id LEFT JOIN workspace_members wm ON wm.user_id=u.id
       WHERE ($1::text IS NULL OR u.email ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%') AND ($2::uuid IS NULL OR u.id>$2)
       GROUP BY u.id,w.balance_units ORDER BY u.id LIMIT $3`,
      [q || null, cursor || null, limit + 1],
    );
    const more = r.rows.length > limit,
      rows = r.rows.slice(0, limit).map(mapUser);
    return { items: rows, nextCursor: more ? rows.at(-1)?.id || null : null };
  }
  updateUser(
    id: string,
    patch: { status?: "active" | "suspended"; platformRole?: "user" | "admin" },
    actor: AdminActor,
  ) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE users SET status=COALESCE($2,status),platform_role=COALESCE($3,platform_role),updated_at=$4 WHERE id=$1 RETURNING *",
        [
          id,
          patch.status || null,
          patch.platformRole || null,
          new Date().toISOString(),
        ],
      );
      if (!r.rows[0]) throw missing("ADMIN_USER_NOT_FOUND", "用户不存在");
      if (patch.status === "suspended")
        await c.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1",
          [id, new Date().toISOString()],
        );
      await audit(c, actor, "user.update", "user", id, patch);
      return mapUser(r.rows[0]);
    });
  }
  revokeSessions(id: string, actor: AdminActor) {
    return this.tx(async (c) => {
      if (!(await c.query("SELECT 1 FROM users WHERE id=$1", [id])).rows[0])
        throw missing("ADMIN_USER_NOT_FOUND", "用户不存在");
      const r = await c.query(
        "UPDATE sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>$2",
        [id, new Date().toISOString()],
      );
      await audit(c, actor, "session.revoke_all", "user", id, {
        revoked: r.rowCount || 0,
      });
      return { revoked: r.rowCount || 0 };
    });
  }
  async jobs(filters: Record<string, string | undefined>, limit: number) {
    const r = await this.pool.query(
      `SELECT id,workspace_id,owner_id,capability,logical_model_id,attempt,status,phase,provider,channel_id,worker_id,error_code,error_message,billing_state,estimated_units,reserved_units,actual_units,created_at,updated_at
       FROM generation_jobs WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR phase=$2) AND ($3::text IS NULL OR provider=$3) AND ($4::uuid IS NULL OR owner_id=$4) ORDER BY updated_at DESC,id DESC LIMIT $5`,
      [
        filters.status || null,
        filters.phase || null,
        filters.provider || null,
        filters.ownerId || null,
        limit,
      ],
    );
    return r.rows.map(camelJob);
  }
  transitionJob(
    id: string,
    action: "requeue" | "cancel" | "review",
    actor: AdminActor,
  ) {
    return this.tx(async (c) => {
      const q = await c.query(
          "SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE",
          [id],
        ),
        job = q.rows[0];
      if (!job) throw missing("ADMIN_JOB_NOT_FOUND", "任务不存在");
      let r;
      if (action === "cancel") {
        if (["succeeded", "failed", "cancelled"].includes(job.status))
          throw state();
        r = await c.query(
          "UPDATE generation_jobs SET status='running',phase='cancel_requested',next_run_at=$2,lease_until=NULL,worker_id=NULL,updated_at=$2 WHERE id=$1 RETURNING *",
          [id, new Date().toISOString()],
        );
      } else if (action === "review" || job.billing_state === "reserved") {
        if (job.status !== "needs_review") throw state();
        r = await c.query(
          "UPDATE generation_jobs SET status='queued',phase='queued',worker_id=NULL,lease_until=NULL,last_heartbeat_at=NULL,next_run_at=$2,error_code=NULL,error_message=NULL,updated_at=$2 WHERE id=$1 RETURNING *",
          [id, new Date().toISOString()],
        );
      } else {
        if (!["failed", "cancelled"].includes(job.status)) throw state();
        const newId = randomUUID(),
          now = new Date().toISOString(),
          units = Number(job.estimated_units);
        if (units > 0) {
          const wallet = await c.query(
            "SELECT balance_units FROM billing_wallets WHERE user_id=$1 FOR UPDATE",
            [job.owner_id],
          );
          if (!wallet.rows[0] || Number(wallet.rows[0].balance_units) < units)
            throw new DomainError(
              "INSUFFICIENT_POINTS",
              409,
              "用户积分不足，无法恢复任务",
            );
          const balance = Number(wallet.rows[0].balance_units) - units;
          await c.query(
            "UPDATE billing_wallets SET balance_units=$2,updated_at=$3 WHERE user_id=$1",
            [job.owner_id, balance, now],
          );
          await c.query(
            "INSERT INTO billing_ledger_entries(id,user_id,job_id,entry_type,amount_units,balance_after_units,idempotency_key,metadata,created_at) VALUES($1,$2,$3,'reserve',$4,$5,$6,$7::jsonb,$8)",
            [
              randomUUID(),
              job.owner_id,
              newId,
              -units,
              balance,
              `job:${newId}:reserve`,
              JSON.stringify({ adminRetryOf: id }),
              now,
            ],
          );
        }
        r = await c.query(
          `INSERT INTO generation_jobs(id,workspace_id,owner_id,capability,logical_model_id,client_request_id,attempt,retry_of,status,phase,input,result,upstream_task_id,provider,channel_id,worker_id,lease_until,last_heartbeat_at,next_run_at,error_code,error_message,created_at,updated_at,billing_state,estimated_units,reserved_units,actual_units)
           SELECT $2,workspace_id,owner_id,capability,logical_model_id,client_request_id,attempt+1,id,'queued','queued',input,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$3,NULL,NULL,$3,$3,CASE WHEN estimated_units>0 THEN 'reserved' ELSE 'free' END,estimated_units,estimated_units,NULL FROM generation_jobs WHERE id=$1 RETURNING *`,
          [id, newId, now],
        );
      }
      await audit(c, actor, `job.${action}`, "generation_job", id, {
        previousStatus: job.status,
        previousPhase: job.phase,
      });
      return camelJob(r.rows[0]);
    });
  }
  async storage() {
    const r = await this.pool.query(
      `SELECT count(*)::int assets,COALESCE(sum(a.bytes),0)::text bytes,count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM media_asset_references r WHERE r.asset_id=a.id))::int unreferenced_assets,COALESCE(sum(a.bytes) FILTER (WHERE NOT EXISTS (SELECT 1 FROM media_asset_references r WHERE r.asset_id=a.id)),0)::text unreferenced_bytes FROM media_assets a`,
    );
    const workspaces = await this.pool.query(
      "SELECT workspace_id,count(*)::int assets,COALESCE(sum(bytes),0)::text bytes FROM media_assets GROUP BY workspace_id ORDER BY sum(bytes) DESC LIMIT 100",
    );
    return { ...numeric(r.rows[0]), workspaces: workspaces.rows.map(numeric) };
  }
  async audit(filters: Record<string, string | undefined>, limit: number) {
    const r = await this.pool.query(
      `SELECT * FROM admin_audit_events WHERE ($1::text IS NULL OR actor_id=$1) AND ($2::text IS NULL OR action=$2) AND ($3::text IS NULL OR resource_type=$3) AND ($4::text IS NULL OR resource_id=$4) AND ($5::text IS NULL OR request_id=$5) ORDER BY created_at DESC,id DESC LIMIT $6`,
      [
        filters.actorId || null,
        filters.action || null,
        filters.resourceType || null,
        filters.resourceId || null,
        filters.requestId || null,
        limit,
      ],
    );
    return r.rows.map((x) => ({
      id: x.id,
      actorType: x.actor_type,
      actorId: x.actor_id,
      action: x.action,
      resourceType: x.resource_type,
      resourceId: x.resource_id,
      requestId: x.request_id,
      details: x.details,
      createdAt: iso(x.created_at),
    }));
  }
  async settings() {
    const r = await this.pool.query(
      "SELECT namespace,key,value,secret_ciphertext IS NOT NULL secret_configured,revision,updated_by,updated_at FROM platform_settings ORDER BY namespace,key",
    );
    return r.rows.map(mapSetting);
  }
  saveSetting(
    input: Parameters<AdminRepository["saveSetting"]>[0],
    actor: AdminActor,
  ) {
    return this.tx(async (c) => {
      const old = await c.query(
          "SELECT * FROM platform_settings WHERE namespace=$1 AND key=$2 FOR UPDATE",
          [input.namespace, input.key],
        ),
        revision = old.rows[0] ? Number(old.rows[0].revision) + 1 : 1;
      if (
        input.expectedRevision !== undefined &&
        Number(old.rows[0]?.revision || 0) !== input.expectedRevision
      )
        throw new DomainError(
          "REVISION_CONFLICT",
          409,
          "配置已被其他管理员修改",
        );
      const r = await c.query(
        `INSERT INTO platform_settings(namespace,key,value,secret_ciphertext,secret_iv,secret_tag,revision,updated_by,updated_at) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) ON CONFLICT(namespace,key) DO UPDATE SET value=EXCLUDED.value,secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at RETURNING namespace,key,value,secret_ciphertext IS NOT NULL secret_configured,revision,updated_by,updated_at`,
        [
          input.namespace,
          input.key,
          input.secret ? null : JSON.stringify(input.value),
          input.secret?.ciphertext || null,
          input.secret?.iv || null,
          input.secret?.tag || null,
          revision,
          actor.id,
          new Date().toISOString(),
        ],
      );
      await audit(
        c,
        actor,
        "setting.update",
        "platform_setting",
        `${input.namespace}.${input.key}`,
        { revision, secret: !!input.secret },
      );
      return mapSetting(r.rows[0]);
    });
  }
  content(input: Parameters<AdminRepository["content"]>[0], actor: AdminActor) {
    return this.tx(async (c) => {
      const old = await c.query(
          "SELECT * FROM admin_content_entries WHERE id=$1 FOR UPDATE",
          [input.id],
        ),
        revision = old.rows[0] ? Number(old.rows[0].revision) + 1 : 1;
      if (
        input.expectedRevision !== undefined &&
        Number(old.rows[0]?.revision || 0) !== input.expectedRevision
      )
        throw new DomainError("REVISION_CONFLICT", 409, "运营内容已被修改");
      const now = new Date().toISOString();
      const r = await c.query(
        `INSERT INTO admin_content_entries(id,kind,title,content,status,starts_at,ends_at,revision,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,status=EXCLUDED.status,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at RETURNING *`,
        [
          input.id,
          input.kind,
          input.title,
          input.content,
          input.status,
          input.startsAt || null,
          input.endsAt || null,
          revision,
          actor.id,
          now,
        ],
      );
      await audit(c, actor, "content.update", "admin_content", input.id, {
        kind: input.kind,
        status: input.status,
        revision,
      });
      return mapContent(r.rows[0]);
    });
  }
  async listContent(kind?: "announcement" | "prompt") {
    const r = await this.pool.query(
      "SELECT * FROM admin_content_entries WHERE ($1::text IS NULL OR kind=$1) ORDER BY updated_at DESC,id",
      [kind || null],
    );
    return r.rows.map(mapContent);
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const x = await fn(c);
      await c.query("COMMIT");
      return x;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
async function audit(
  c: Pick<PoolClient, "query">,
  a: AdminActor,
  action: string,
  type: string,
  id: string,
  details: unknown,
) {
  await c.query(
    "INSERT INTO admin_audit_events(id,actor_type,actor_id,action,resource_type,resource_id,request_id,details,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",
    [
      randomUUID(),
      a.type,
      a.id,
      action,
      type,
      id,
      a.requestId,
      JSON.stringify(details),
      new Date().toISOString(),
    ],
  );
}
const missing = (code: string, message: string) =>
  new DomainError(code, 404, message);
const state = () =>
  new DomainError("ADMIN_JOB_STATE_INVALID", 409, "任务状态不允许该操作");
const iso = (x: unknown) => new Date(x as string).toISOString();
const numeric = (x: any) =>
  Object.fromEntries(
    Object.entries(x).map(([k, v]) => [
      k,
      typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v,
    ]),
  );
const mapUser = (x: any) => ({
  id: x.id,
  email: x.email,
  name: x.name,
  status: x.status,
  platformRole: x.platform_role,
  createdAt: iso(x.created_at),
  updatedAt: iso(x.updated_at),
  balanceUnits: Number(x.balance_units || 0),
  activeSessions: Number(x.active_sessions || 0),
  workspaces: Number(x.workspaces || 0),
});
const camelJob = (x: any) => ({
  id: x.id,
  workspaceId: x.workspace_id,
  ownerId: x.owner_id,
  capability: x.capability,
  logicalModelId: x.logical_model_id,
  attempt: x.attempt,
  status: x.status,
  phase: x.phase,
  provider: x.provider,
  channelId: x.channel_id,
  workerId: x.worker_id,
  errorCode: x.error_code,
  errorMessage: x.error_message,
  billing: {
    state: x.billing_state,
    estimatedUnits: Number(x.estimated_units),
    reservedUnits: Number(x.reserved_units),
    actualUnits: x.actual_units === null ? null : Number(x.actual_units),
  },
  createdAt: iso(x.created_at),
  updatedAt: iso(x.updated_at),
});
const mapSetting = (x: any): AdminSetting => ({
  namespace: x.namespace,
  key: x.key,
  value: x.value,
  secretConfigured: x.secret_configured,
  revision: Number(x.revision),
  updatedBy: x.updated_by,
  updatedAt: iso(x.updated_at),
});
const mapContent = (x: any) => ({
  id: x.id,
  kind: x.kind,
  title: x.title,
  content: x.content,
  status: x.status,
  startsAt: x.starts_at ? iso(x.starts_at) : null,
  endsAt: x.ends_at ? iso(x.ends_at) : null,
  revision: Number(x.revision),
  createdBy: x.created_by,
  createdAt: iso(x.created_at),
  updatedAt: iso(x.updated_at),
});
