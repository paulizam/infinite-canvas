import pg from "pg";
import { DomainError } from "./domain.js";
import type {
  TriggerInvocation,
  WorkflowTriggerRecord,
  WorkflowTriggerRepository,
} from "./workflow-trigger-repository.js";

export class PostgresWorkflowTriggerRepository implements WorkflowTriggerRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async create(trigger: WorkflowTriggerRecord) {
    const result = await this.pool.query(
      `INSERT INTO workflow_triggers(id,workflow_id,workflow_version,workspace_id,created_by,kind,target_node_id,token_hash,config,enabled,next_run_at,worker_id,lease_until,created_at,updated_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NULL,NULL,$12,$13
       WHERE EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$4 AND user_id=$5 AND role IN ('owner','admin','editor')) RETURNING *`,
      triggerValues(trigger),
    );
    if (!result.rows[0])
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    return mapTrigger(result.rows[0]);
  }
  async list(userId: string, workflowId: string) {
    const result = await this.pool.query(
      `SELECT t.* FROM workflow_triggers t JOIN workspace_members m ON m.workspace_id=t.workspace_id
       WHERE t.workflow_id=$1 AND m.user_id=$2 ORDER BY t.created_at DESC`,
      [workflowId, userId],
    );
    return result.rows.map(mapTrigger);
  }
  async disable(userId: string, triggerId: string, now: string) {
    const result = await this.pool.query(
      `UPDATE workflow_triggers t SET enabled=false,worker_id=NULL,lease_until=NULL,updated_at=$3
       FROM workspace_members m WHERE t.id=$1 AND m.user_id=$2 AND m.workspace_id=t.workspace_id
       AND m.role IN ('owner','admin','editor') RETURNING t.*`,
      [triggerId, userId, now],
    );
    if (!result.rows[0])
      throw new DomainError("TRIGGER_NOT_FOUND", 404, "Trigger 不存在");
    return mapTrigger(result.rows[0]);
  }
  async getForToken(triggerId: string, tokenHash: string) {
    const result = await this.pool.query(
      "SELECT * FROM workflow_triggers WHERE id=$1 AND token_hash=$2 AND enabled=true",
      [triggerId, tokenHash],
    );
    return result.rows[0] ? mapTrigger(result.rows[0]) : null;
  }
  async reserveInvocation(input: TriggerInvocation & { maxPerMinute: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM workflow_triggers WHERE id=$1 FOR UPDATE",
        [input.triggerId],
      );
      const existing = await client.query(
        "SELECT * FROM workflow_trigger_invocations WHERE trigger_id=$1 AND idempotency_key=$2",
        [input.triggerId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { invocation: mapInvocation(existing.rows[0]), replayed: true };
      }
      const count = await client.query(
        "SELECT count(*)::int AS value FROM workflow_trigger_invocations WHERE trigger_id=$1 AND created_at>$2::timestamptz-interval '1 minute'",
        [input.triggerId, input.createdAt],
      );
      if (Number(count.rows[0]?.value) >= input.maxPerMinute)
        throw new DomainError(
          "TRIGGER_RATE_LIMITED",
          429,
          "Trigger 调用过于频繁",
        );
      const inserted = await client.query(
        `INSERT INTO workflow_trigger_invocations(id,trigger_id,idempotency_key,execution_id,created_at)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [
          input.id,
          input.triggerId,
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
  async claimSchedules(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }) {
    const result = await this.pool.query(
      `WITH due AS (SELECT id FROM workflow_triggers WHERE kind='schedule' AND enabled=true AND next_run_at<=$1
       AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT $3)
       UPDATE workflow_triggers t SET worker_id=$2,lease_until=$4 FROM due WHERE t.id=due.id RETURNING t.*`,
      [input.now, input.workerId, input.limit, input.leaseUntil],
    );
    return result.rows.map(mapTrigger);
  }
  async getClaimedSchedule(workerId: string, triggerId: string, now: string) {
    const result = await this.pool.query(
      "SELECT * FROM workflow_triggers WHERE id=$1 AND kind='schedule' AND worker_id=$2 AND lease_until>$3",
      [triggerId, workerId, now],
    );
    return result.rows[0] ? mapTrigger(result.rows[0]) : null;
  }
  async completeSchedule(
    workerId: string,
    triggerId: string,
    now: string,
    nextRunAt: string,
  ) {
    const result = await this.pool.query(
      `UPDATE workflow_triggers SET next_run_at=$4,worker_id=NULL,lease_until=NULL,updated_at=$3
       WHERE id=$1 AND worker_id=$2 AND lease_until>$3 RETURNING *`,
      [triggerId, workerId, now, nextRunAt],
    );
    if (!result.rows[0])
      throw new DomainError("TRIGGER_LEASE_LOST", 409, "Trigger 租约已失效");
    return mapTrigger(result.rows[0]);
  }
}

function triggerValues(trigger: WorkflowTriggerRecord) {
  return [
    trigger.id,
    trigger.workflowId,
    trigger.workflowVersion,
    trigger.workspaceId,
    trigger.createdBy,
    trigger.kind,
    trigger.targetNodeId,
    trigger.tokenHash,
    JSON.stringify(trigger.config),
    trigger.enabled,
    trigger.nextRunAt,
    trigger.createdAt,
    trigger.updatedAt,
  ];
}
function mapTrigger(row: Record<string, unknown>): WorkflowTriggerRecord {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    workspaceId: String(row.workspace_id),
    createdBy: String(row.created_by),
    kind: row.kind as WorkflowTriggerRecord["kind"],
    targetNodeId: String(row.target_node_id),
    tokenHash: row.token_hash ? String(row.token_hash) : null,
    config: row.config as Record<string, unknown>,
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at ? iso(row.next_run_at) : null,
    workerId: row.worker_id ? String(row.worker_id) : null,
    leaseUntil: row.lease_until ? iso(row.lease_until) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapInvocation(row: Record<string, unknown>): TriggerInvocation {
  return {
    id: String(row.id),
    triggerId: String(row.trigger_id),
    idempotencyKey: String(row.idempotency_key),
    executionId: String(row.execution_id),
    createdAt: iso(row.created_at),
  };
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
