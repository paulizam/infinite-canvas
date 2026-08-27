import pg from "pg";
import { DomainError } from "./domain.js";
import type {
  WorkflowApiAuditEvent,
  WorkflowApiInvocation,
  WorkflowApiTokenRecord,
  WorkflowPublicApiRepository,
} from "./workflow-public-api-repository.js";

export class PostgresWorkflowPublicApiRepository implements WorkflowPublicApiRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async create(record: WorkflowApiTokenRecord) {
    const result = await this.pool.query(
      `INSERT INTO workflow_api_tokens(id,workflow_id,workflow_version,workspace_id,created_by,name,token_prefix,token_hash,scopes,rate_limit_per_minute,revoked_at,created_at,last_used_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,NULL,$11,NULL
       WHERE EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$4 AND user_id=$5 AND role IN ('owner','admin','editor')) RETURNING *`,
      [
        record.id,
        record.workflowId,
        record.workflowVersion,
        record.workspaceId,
        record.createdBy,
        record.name,
        record.tokenPrefix,
        record.tokenHash,
        record.scopes,
        record.rateLimitPerMinute,
        record.createdAt,
      ],
    );
    if (!result.rows[0])
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    return mapToken(result.rows[0]);
  }
  async list(userId: string, workflowId: string) {
    const result = await this.pool.query(
      `SELECT t.* FROM workflow_api_tokens t JOIN workspace_members m ON m.workspace_id=t.workspace_id
       WHERE t.workflow_id=$1 AND m.user_id=$2 ORDER BY t.created_at DESC`,
      [workflowId, userId],
    );
    return result.rows.map(mapToken);
  }
  async revoke(userId: string, tokenId: string, now: string) {
    const result = await this.pool.query(
      `UPDATE workflow_api_tokens t SET revoked_at=COALESCE(t.revoked_at,$3::timestamptz)
       FROM workspace_members m WHERE t.id=$1 AND m.user_id=$2 AND m.workspace_id=t.workspace_id
       AND m.role IN ('owner','admin','editor') RETURNING t.*`,
      [tokenId, userId, now],
    );
    if (!result.rows[0])
      throw new DomainError(
        "WORKFLOW_API_TOKEN_NOT_FOUND",
        404,
        "API token 不存在",
      );
    return mapToken(result.rows[0]);
  }
  async rotate(
    userId: string,
    tokenId: string,
    replacement: Pick<
      WorkflowApiTokenRecord,
      "id" | "tokenPrefix" | "tokenHash" | "createdAt"
    >,
  ) {
    const result = await this.pool.query(
      `WITH old AS (
         UPDATE workflow_api_tokens t SET revoked_at=COALESCE(t.revoked_at,$6::timestamptz)
         FROM workspace_members m WHERE t.id=$1 AND t.revoked_at IS NULL AND m.user_id=$2 AND m.workspace_id=t.workspace_id
         AND m.role IN ('owner','admin','editor') RETURNING t.*
       )
       INSERT INTO workflow_api_tokens(id,workflow_id,workflow_version,workspace_id,created_by,name,token_prefix,token_hash,scopes,rate_limit_per_minute,created_at)
       SELECT $3,workflow_id,workflow_version,workspace_id,$2,name,$4,$5,scopes,rate_limit_per_minute,$6 FROM old RETURNING *`,
      [
        tokenId,
        userId,
        replacement.id,
        replacement.tokenPrefix,
        replacement.tokenHash,
        replacement.createdAt,
      ],
    );
    if (!result.rows[0])
      throw new DomainError(
        "WORKFLOW_API_TOKEN_NOT_FOUND",
        404,
        "API token 不存在",
      );
    return mapToken(result.rows[0]);
  }
  async getByHash(tokenHash: string) {
    const result = await this.pool.query(
      "SELECT * FROM workflow_api_tokens WHERE token_hash=$1 AND revoked_at IS NULL",
      [tokenHash],
    );
    return result.rows[0] ? mapToken(result.rows[0]) : null;
  }
  async reserve(input: WorkflowApiInvocation & { maxPerMinute: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM workflow_api_tokens WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
        [input.tokenId],
      );
      const existing = await client.query(
        "SELECT * FROM workflow_api_invocations WHERE token_id=$1 AND idempotency_key=$2",
        [input.tokenId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { invocation: mapInvocation(existing.rows[0]), replayed: true };
      }
      const count = await client.query(
        "SELECT count(*)::int AS value FROM workflow_api_invocations WHERE token_id=$1 AND created_at>$2::timestamptz-interval '1 minute'",
        [input.tokenId, input.createdAt],
      );
      if (Number(count.rows[0]?.value) >= input.maxPerMinute)
        throw new DomainError(
          "WORKFLOW_API_RATE_LIMITED",
          429,
          "Workflow API 调用过于频繁",
        );
      const inserted = await client.query(
        "INSERT INTO workflow_api_invocations(id,token_id,idempotency_key,execution_id,created_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          input.id,
          input.tokenId,
          input.idempotencyKey,
          input.executionId,
          input.createdAt,
        ],
      );
      await client.query("COMMIT");
      return { invocation: mapInvocation(inserted.rows[0]), replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async audit(input: {
    id: string;
    tokenId: string;
    action: "invoke" | "read_execution";
    executionId?: string;
    requestId?: string;
    createdAt: string;
  }) {
    await this.pool.query(
      `WITH event AS (INSERT INTO workflow_api_audit_events(id,token_id,action,execution_id,request_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING token_id) UPDATE workflow_api_tokens t SET last_used_at=$6 FROM event WHERE t.id=event.token_id`,
      [
        input.id,
        input.tokenId,
        input.action,
        input.executionId || null,
        input.requestId || null,
        input.createdAt,
      ],
    );
  }
  async listAudit(userId: string, workflowId: string, limit: number) {
    const result = await this.pool.query(
      `SELECT a.*,t.name AS token_name FROM workflow_api_audit_events a
       JOIN workflow_api_tokens t ON t.id=a.token_id JOIN workspace_members m ON m.workspace_id=t.workspace_id
       WHERE t.workflow_id=$1 AND m.user_id=$2 ORDER BY a.created_at DESC LIMIT $3`,
      [workflowId, userId, limit],
    );
    return result.rows.map(mapAudit);
  }
}

function mapToken(row: Record<string, unknown>): WorkflowApiTokenRecord {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    workspaceId: String(row.workspace_id),
    createdBy: String(row.created_by),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    tokenHash: String(row.token_hash),
    scopes: row.scopes as WorkflowApiTokenRecord["scopes"],
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    createdAt: iso(row.created_at),
    lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
  };
}
function mapInvocation(row: Record<string, unknown>): WorkflowApiInvocation {
  return {
    id: String(row.id),
    tokenId: String(row.token_id),
    idempotencyKey: String(row.idempotency_key),
    executionId: String(row.execution_id),
    createdAt: iso(row.created_at),
  };
}
function mapAudit(row: Record<string, unknown>): WorkflowApiAuditEvent {
  return {
    id: String(row.id),
    tokenId: String(row.token_id),
    tokenName: String(row.token_name),
    action: row.action as WorkflowApiAuditEvent["action"],
    executionId: row.execution_id ? String(row.execution_id) : null,
    requestId: row.request_id ? String(row.request_id) : null,
    createdAt: iso(row.created_at),
  };
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
