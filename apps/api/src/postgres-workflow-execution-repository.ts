import pg from "pg";
import { DomainError } from "./domain.js";
import {
  sameExecutionCreation,
  type WorkflowExecutionRecord,
  type WorkflowExecutionRepository,
} from "./workflow-execution-repository.js";

export class PostgresWorkflowExecutionRepository implements WorkflowExecutionRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async create(record: WorkflowExecutionRecord) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const access = await client.query(
        `SELECT 1 FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id
         JOIN workspace_members m ON m.workspace_id=w.workspace_id
         WHERE v.workflow_id=$1 AND v.version=$2 AND w.workspace_id=$3 AND m.user_id=$4 AND m.role IN ('owner','admin','editor')`,
        [
          record.state.workflowId,
          record.state.workflowVersion,
          record.workspaceId,
          record.createdBy,
        ],
      );
      if (!access.rows[0])
        throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
      const inserted = await client.query(
        `INSERT INTO workflow_executions(id,workflow_id,workflow_version,workspace_id,status,selected_node_ids,layers,initial_inputs,revision,created_by,created_at,updated_at,completed_at,next_run_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,0,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING RETURNING id`,
        executionValues(record),
      );
      if (!inserted.rows[0]) {
        const existing = await load(
          client,
          record.createdBy,
          record.state.id,
          false,
        );
        if (!existing)
          throw new DomainError("EXECUTION_NOT_FOUND", 404, "执行不存在");
        if (!sameExecutionCreation(existing, record))
          throw new DomainError(
            "EXECUTION_ID_CONFLICT",
            409,
            "executionId 已用于其他执行请求",
          );
        await client.query("COMMIT");
        return { record: existing, replayed: true };
      }
      await writeChildren(client, record);
      await client.query("COMMIT");
      return { record, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async get(userId: string, executionId: string) {
    return load(this.pool, userId, executionId, false);
  }
  async save(
    userId: string,
    record: WorkflowExecutionRecord,
    expectedRevision: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await load(client, userId, record.state.id, true, true);
      if (!current)
        throw new DomainError("EXECUTION_NOT_FOUND", 404, "执行不存在");
      if (current.revision !== expectedRevision)
        throw new DomainError(
          "EXECUTION_REVISION_CONFLICT",
          409,
          "执行版本冲突",
        );
      if (!sameExecutionCreation(current, record))
        throw new DomainError(
          "EXECUTION_IDENTITY_CONFLICT",
          409,
          "执行身份或初始快照不可修改",
        );
      const next = { ...record, revision: expectedRevision + 1 };
      await client.query(
        `UPDATE workflow_executions SET status=$2,revision=$3,updated_at=$4,completed_at=$5 WHERE id=$1`,
        [
          record.state.id,
          record.state.status,
          next.revision,
          record.state.updatedAt,
          record.state.completedAt || null,
        ],
      );
      await writeChildren(client, next);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async claim(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }) {
    const result = await this.pool.query(
      `WITH due AS (SELECT id FROM workflow_executions WHERE status IN ('queued','running','waiting','cancel_requested')
       AND next_run_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT $3)
       UPDATE workflow_executions e SET worker_id=$2,lease_until=$4,last_heartbeat_at=$1 FROM due WHERE e.id=due.id RETURNING e.id`,
      [input.now, input.workerId, input.limit, input.leaseUntil],
    );
    const records = await Promise.all(
      result.rows.map((row) => loadInternal(this.pool, String(row.id))),
    );
    return records.filter((record): record is WorkflowExecutionRecord =>
      Boolean(record),
    );
  }
  async heartbeat(
    workerId: string,
    executionIds: string[],
    now: string,
    leaseUntil: string,
  ) {
    if (!executionIds.length) return 0;
    const result = await this.pool.query(
      "UPDATE workflow_executions SET lease_until=$4,last_heartbeat_at=$3 WHERE worker_id=$1 AND id=ANY($2::uuid[]) AND lease_until>$3",
      [workerId, [...new Set(executionIds)], now, leaseUntil],
    );
    return result.rowCount || 0;
  }
  async getForWorker(workerId: string, executionId: string, now: string) {
    return loadWorker(this.pool, workerId, executionId, now, false);
  }
  async saveByWorker(
    workerId: string,
    record: WorkflowExecutionRecord,
    expectedRevision: number,
    now: string,
    nextRunAt: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await loadWorker(
        client,
        workerId,
        record.state.id,
        now,
        true,
      );
      if (!current)
        throw new DomainError("EXECUTION_LEASE_LOST", 409, "执行租约已失效");
      if (current.revision !== expectedRevision)
        throw new DomainError(
          "EXECUTION_REVISION_CONFLICT",
          409,
          "执行版本冲突",
        );
      if (!sameExecutionCreation(current, record))
        throw new DomainError(
          "EXECUTION_IDENTITY_CONFLICT",
          409,
          "执行身份或初始快照不可修改",
        );
      const next = { ...record, revision: expectedRevision + 1, nextRunAt };
      await client.query(
        "UPDATE workflow_executions SET status=$2,revision=$3,updated_at=$4,completed_at=$5,next_run_at=$6 WHERE id=$1",
        [
          record.state.id,
          record.state.status,
          next.revision,
          record.state.updatedAt,
          record.state.completedAt || null,
          nextRunAt,
        ],
      );
      await writeChildren(client, next);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function executionValues(record: WorkflowExecutionRecord) {
  const state = record.state;
  return [
    state.id,
    state.workflowId,
    state.workflowVersion,
    record.workspaceId,
    state.status,
    JSON.stringify(state.selectedNodeIds),
    JSON.stringify(state.layers),
    JSON.stringify(state.initialInputs),
    record.createdBy,
    state.createdAt,
    state.updatedAt,
    state.completedAt || null,
    record.nextRunAt,
  ];
}
async function writeChildren(
  client: pg.PoolClient,
  record: WorkflowExecutionRecord,
) {
  for (const node of Object.values(record.state.nodes))
    await client.query(
      `INSERT INTO workflow_node_executions(execution_id,node_id,status,attempt,max_attempts,input_snapshot,output_snapshot,error,skip_reason,steps,started_at,completed_at,wake_at,event_key)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14)
       ON CONFLICT(execution_id,node_id) DO UPDATE SET status=EXCLUDED.status,attempt=EXCLUDED.attempt,max_attempts=EXCLUDED.max_attempts,input_snapshot=EXCLUDED.input_snapshot,output_snapshot=EXCLUDED.output_snapshot,error=EXCLUDED.error,skip_reason=EXCLUDED.skip_reason,steps=EXCLUDED.steps,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,wake_at=EXCLUDED.wake_at,event_key=EXCLUDED.event_key`,
      [
        record.state.id,
        node.nodeId,
        node.status,
        node.attempt,
        node.maxAttempts,
        json(node.input),
        json(node.output),
        json(node.error),
        node.skipReason || null,
        JSON.stringify(node.steps),
        node.startedAt || null,
        node.completedAt || null,
        node.wakeAt || null,
        node.eventKey || null,
      ],
    );
  for (const event of record.state.events)
    await client.query(
      `INSERT INTO workflow_execution_events(execution_id,sequence,event_type,node_id,step_key,data,created_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(execution_id,sequence) DO NOTHING`,
      [
        record.state.id,
        event.sequence,
        event.type,
        event.nodeId || null,
        event.stepKey || null,
        json(event.data),
        event.createdAt,
      ],
    );
}
async function load(
  db: pg.Pool | pg.PoolClient,
  userId: string,
  executionId: string,
  lock: boolean,
  editor = false,
): Promise<WorkflowExecutionRecord | null> {
  const result = await db.query(
    `SELECT e.*,v.definition AS workflow_definition FROM workflow_executions e
     JOIN workflow_versions v ON v.workflow_id=e.workflow_id AND v.version=e.workflow_version
     JOIN workspace_members m ON m.workspace_id=e.workspace_id
     WHERE e.id=$1 AND m.user_id=$2 ${editor ? "AND m.role IN ('owner','admin','editor')" : ""} ${lock ? "FOR UPDATE OF e" : ""}`,
    [executionId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return hydrate(db, row);
}
async function loadInternal(db: pg.Pool | pg.PoolClient, executionId: string) {
  const result = await db.query(
    `SELECT e.*,v.definition AS workflow_definition FROM workflow_executions e
     JOIN workflow_versions v ON v.workflow_id=e.workflow_id AND v.version=e.workflow_version WHERE e.id=$1`,
    [executionId],
  );
  return result.rows[0] ? hydrate(db, result.rows[0]) : null;
}
async function loadWorker(
  db: pg.Pool | pg.PoolClient,
  workerId: string,
  executionId: string,
  now: string,
  lock: boolean,
) {
  const result = await db.query(
    `SELECT e.*,v.definition AS workflow_definition FROM workflow_executions e
     JOIN workflow_versions v ON v.workflow_id=e.workflow_id AND v.version=e.workflow_version
     WHERE e.id=$1 AND e.worker_id=$2 AND e.lease_until>$3 ${lock ? "FOR UPDATE OF e" : ""}`,
    [executionId, workerId, now],
  );
  return result.rows[0] ? hydrate(db, result.rows[0]) : null;
}
async function hydrate(
  db: pg.Pool | pg.PoolClient,
  row: Record<string, unknown>,
): Promise<WorkflowExecutionRecord> {
  const executionId = String(row.id);
  const nodes = await db.query(
    "SELECT * FROM workflow_node_executions WHERE execution_id=$1 ORDER BY node_id",
    [executionId],
  );
  const events = await db.query(
    "SELECT * FROM workflow_execution_events WHERE execution_id=$1 ORDER BY sequence",
    [executionId],
  );
  return {
    revision: Number(row.revision),
    workspaceId: String(row.workspace_id),
    createdBy: String(row.created_by),
    definition: row.workflow_definition,
    workerId: row.worker_id ? String(row.worker_id) : null,
    leaseUntil: row.lease_until ? iso(row.lease_until) : null,
    nextRunAt: iso(row.next_run_at),
    state: {
      id: String(row.id),
      workflowId: String(row.workflow_id),
      workflowVersion: Number(row.workflow_version),
      status: row.status,
      selectedNodeIds: row.selected_node_ids,
      layers: row.layers,
      initialInputs: row.initial_inputs,
      nodes: Object.fromEntries(
        nodes.rows.map((node) => [
          String(node.node_id),
          {
            nodeId: String(node.node_id),
            status: node.status,
            attempt: Number(node.attempt),
            maxAttempts: Number(node.max_attempts),
            ...(node.input_snapshot === null
              ? {}
              : { input: node.input_snapshot }),
            ...(node.output_snapshot === null
              ? {}
              : { output: node.output_snapshot }),
            ...(node.error === null ? {} : { error: node.error }),
            ...(node.skip_reason ? { skipReason: node.skip_reason } : {}),
            steps: node.steps,
            ...(node.started_at ? { startedAt: iso(node.started_at) } : {}),
            ...(node.completed_at
              ? { completedAt: iso(node.completed_at) }
              : {}),
            ...(node.wake_at ? { wakeAt: iso(node.wake_at) } : {}),
            ...(node.event_key ? { eventKey: String(node.event_key) } : {}),
          },
        ]),
      ),
      events: events.rows.map((event) => ({
        sequence: Number(event.sequence),
        type: String(event.event_type),
        createdAt: iso(event.created_at),
        ...(event.node_id ? { nodeId: String(event.node_id) } : {}),
        ...(event.step_key ? { stepKey: String(event.step_key) } : {}),
        ...(event.data === null ? {} : { data: event.data }),
      })),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    },
  } as WorkflowExecutionRecord;
}
function json(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
