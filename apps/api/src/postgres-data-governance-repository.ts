import pg from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  AccountExport,
  BlobGcItem,
  DataGovernanceRepository,
} from "./data-governance-repository.js";

export class PostgresDataGovernanceRepository implements DataGovernanceRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async exportAccount(userId: string, exportedAt: string) {
    const [user, workspaces, projects, assets, jobs, ledger, orders] =
      await Promise.all([
        this.pool.query(
          "SELECT id,email,name,created_at FROM users WHERE id=$1 AND status='active'",
          [userId],
        ),
        this.pool.query(
          "SELECT w.id,w.name,m.role,w.created_at FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at",
          [userId],
        ),
        this.pool.query(
          "SELECT id,workspace_id,document,created_at,updated_at FROM canvas_projects WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1) ORDER BY created_at",
          [userId],
        ),
        this.pool.query(
          "SELECT id,workspace_id,sha256,bytes,mime_type,kind,original_name,created_at FROM media_assets WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1) ORDER BY created_at",
          [userId],
        ),
        this.pool.query(
          "SELECT id,workspace_id,capability,logical_model_id,status,phase,error_code,created_at,updated_at,billing_state,estimated_units,reserved_units,actual_units FROM generation_jobs WHERE owner_id=$1 ORDER BY created_at",
          [userId],
        ),
        this.pool.query(
          "SELECT id,job_id,entry_type,amount_units,balance_after_units,metadata,created_at FROM billing_ledger_entries WHERE user_id=$1 ORDER BY created_at",
          [userId],
        ),
        this.pool.query(
          "SELECT id,product_id,status,currency,amount_minor,provider,created_at,updated_at FROM billing_orders WHERE user_id=$1 ORDER BY created_at",
          [userId],
        ),
      ]);
    if (!user.rows[0])
      throw new DomainError("ACCOUNT_NOT_FOUND", 404, "账户不存在");
    const profile = user.rows[0];
    return {
      schemaVersion: 1 as const,
      exportedAt,
      profile: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        createdAt: iso(profile.created_at),
      },
      workspaces: normalizeRows(workspaces.rows),
      projects: normalizeRows(projects.rows),
      assets: normalizeRows(assets.rows),
      generationJobs: normalizeRows(jobs.rows),
      billingLedger: normalizeRows(ledger.rows),
      orders: normalizeRows(orders.rows),
    } satisfies AccountExport;
  }

  anonymizeAccount(userId: string, requestId: string, now: string) {
    return this.tx(async (c) => {
      const user = await c.query(
        "SELECT status FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      );
      if (!user.rows[0])
        throw new DomainError("ACCOUNT_NOT_FOUND", 404, "账户不存在");
      if (user.rows[0].status === "deleted") return { deletedAt: now };
      const owned = await c.query(
        "SELECT workspace_id FROM workspace_members WHERE user_id=$1 AND role='owner'",
        [userId],
      );
      for (const row of owned.rows)
        await c.query(
          `UPDATE workspace_members SET role='owner' WHERE (workspace_id,user_id)=(SELECT workspace_id,user_id FROM workspace_members WHERE workspace_id=$1 AND user_id<>$2 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,user_id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id<>$2 AND role='owner')`,
          [row.workspace_id, userId],
        );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await c.query("DELETE FROM workspace_members WHERE user_id=$1", [userId]);
      await c.query(
        `UPDATE users SET email='deleted+' || id || '@invalid.local',name='已注销用户',password_hash='deleted:' || id,status='deleted',platform_role='user',deleted_at=$2,updated_at=$2 WHERE id=$1`,
        [userId, now],
      );
      await c.query(
        "INSERT INTO account_deletions(user_id,request_id,requested_at,completed_at) VALUES($1,$2,$3,$3) ON CONFLICT(user_id) DO NOTHING",
        [userId, requestId, now],
      );
      await audit(c, "user", userId, requestId, "account.delete", userId, {
        identityAnonymized: true,
        businessRecordsRetained: true,
      });
      return { deletedAt: now };
    });
  }

  async prepareBlobGc(input: {
    olderThan: string;
    limit: number;
    dryRun: boolean;
    requestId: string;
    now: string;
  }) {
    if (input.dryRun) {
      const r = await this.pool.query(
        `SELECT id asset_id,storage_key FROM media_assets a WHERE created_at<$1 AND NOT EXISTS(SELECT 1 FROM media_asset_references r WHERE r.asset_id=a.id) ORDER BY created_at,id LIMIT $2`,
        [input.olderThan, input.limit],
      );
      return { candidates: r.rows.map(candidate), queued: [] };
    }
    return this.tx(async (c) => {
      const r = await c.query(
        `SELECT id asset_id,storage_key FROM media_assets a WHERE created_at<$1 AND NOT EXISTS(SELECT 1 FROM media_asset_references r WHERE r.asset_id=a.id) ORDER BY created_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [input.olderThan, input.limit],
      );
      const candidates = r.rows.map(candidate),
        queued: BlobGcItem[] = [];
      for (const item of candidates) {
        await c.query("SAVEPOINT asset_gc_item");
        try {
          const removed = await c.query(
            "DELETE FROM media_assets WHERE id=$1 RETURNING id",
            [item.assetId],
          );
          if (removed.rowCount) {
            await c.query(
              "INSERT INTO media_blob_gc(id,asset_id,storage_key,state,created_at,updated_at) VALUES($1,$2,$3,'pending',$4,$4)",
              [item.id, item.assetId, item.storageKey, input.now],
            );
            queued.push(item);
          }
          await c.query("RELEASE SAVEPOINT asset_gc_item");
        } catch (error) {
          await c.query("ROLLBACK TO SAVEPOINT asset_gc_item");
          await c.query("RELEASE SAVEPOINT asset_gc_item");
          if ((error as { code?: string }).code !== "23503") throw error;
        }
      }
      await audit(
        c,
        "maintenance",
        "maintenance",
        input.requestId,
        "media.gc.prepare",
        "batch",
        {
          olderThan: input.olderThan,
          candidates: candidates.length,
          queued: queued.length,
        },
      );
      return { candidates, queued };
    });
  }

  async pendingBlobGc(limit: number) {
    const r = await this.pool.query(
      "SELECT id,asset_id,storage_key FROM media_blob_gc WHERE state IN ('pending','failed') ORDER BY updated_at,id LIMIT $1",
      [limit],
    );
    return r.rows.map(candidateWithId);
  }
  async completeBlobGc(id: string, now: string) {
    await this.pool.query(
      "UPDATE media_blob_gc SET state='deleted',attempts=attempts+1,last_error=NULL,updated_at=$2 WHERE id=$1",
      [id, now],
    );
  }
  async failBlobGc(id: string, message: string, now: string) {
    await this.pool.query(
      "UPDATE media_blob_gc SET state='failed',attempts=attempts+1,last_error=$2,updated_at=$3 WHERE id=$1",
      [id, message.slice(0, 500), now],
    );
  }

  applyRetention(input: { cutoffAt: string; requestId: string; now: string }) {
    return this.tx(async (c) => {
      const sessions = await c.query(
        "DELETE FROM sessions WHERE expires_at<$1 OR (revoked_at IS NOT NULL AND revoked_at<$1)",
        [input.cutoffAt],
      );
      const events = await c.query(
        `DELETE FROM generation_events e USING generation_jobs j WHERE e.job_id=j.id AND j.updated_at<$1 AND j.status IN ('succeeded','failed','cancelled','needs_review')`,
        [input.cutoffAt],
      );
      const audits = await c.query(
        "SELECT count(*)::bigint count FROM admin_audit_events",
      );
      const result = {
        expiredSessions: sessions.rowCount || 0,
        generationEvents: events.rowCount || 0,
        auditEventsPreserved: Number(audits.rows[0].count),
      };
      await c.query(
        "INSERT INTO data_retention_runs(id,request_id,cutoff_at,expired_sessions,generation_events,audit_events_preserved,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          input.requestId,
          input.cutoffAt,
          result.expiredSessions,
          result.generationEvents,
          result.auditEventsPreserved,
          input.now,
        ],
      );
      await audit(
        c,
        "maintenance",
        "maintenance",
        input.requestId,
        "retention.apply",
        "batch",
        { cutoffAt: input.cutoffAt, ...result },
      );
      return result;
    });
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
}

const candidate = (x: any): BlobGcItem => ({
  id: randomUUID(),
  assetId: String(x.asset_id),
  storageKey: String(x.storage_key),
});
const candidateWithId = (x: any): BlobGcItem => ({
  id: String(x.id),
  assetId: String(x.asset_id),
  storageKey: String(x.storage_key),
});
const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x));
const normalizeRows = (rows: any[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, x) => x.toUpperCase()),
        redactBusinessValue(value, key),
      ]),
    ),
  );
async function audit(
  c: Pick<pg.PoolClient, "query">,
  actorType: "user" | "maintenance",
  actorId: string,
  requestId: string,
  action: string,
  resourceId: string,
  details: unknown,
) {
  await c.query(
    "INSERT INTO admin_audit_events(id,actor_type,actor_id,action,resource_type,resource_id,request_id,details,created_at) VALUES($1,$2,$3,$4,'data_governance',$5,$6,$7::jsonb,$8)",
    [
      randomUUID(),
      actorType,
      actorId,
      action,
      resourceId,
      requestId,
      JSON.stringify(details),
      new Date().toISOString(),
    ],
  );
}

export function redactBusinessValue(value: unknown, key = ""): unknown {
  if (/(password|secret|token|authorization|api[_-]?key)/i.test(key))
    return "[REDACTED]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => redactBusinessValue(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactBusinessValue(child, childKey),
      ]),
    );
  return value;
}
