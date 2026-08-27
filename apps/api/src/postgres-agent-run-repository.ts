import pg from "pg";
import { DomainError } from "./domain.js";
import type {
  AgentRunApproval,
  AgentRunDetail,
  AgentRunEvent,
  AgentRunRecord,
  AgentRunRepository,
  AgentRunResult,
  AgentRunSubtask,
  AgentSessionRecord,
} from "./agent-run-repository.js";

export class PostgresAgentRunRepository implements AgentRunRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async createSession(value: AgentSessionRecord) {
    const result = await this.pool.query(
      `INSERT INTO agent_sessions(id,workspace_id,project_id,created_by,title,created_at,updated_at)
      SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$2 AND user_id=$4 AND role IN ('owner','admin','editor'))
      AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM canvas_projects WHERE id=$3 AND workspace_id=$2)) RETURNING *`,
      sessionValues(value),
    );
    if (!result.rows[0])
      throw new DomainError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在");
    return mapSession(result.rows[0]);
  }
  async listSessions(userId: string, workspaceId: string) {
    const result = await this.pool.query(
      `SELECT s.* FROM agent_sessions s JOIN workspace_members m ON m.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND m.user_id=$2 ORDER BY s.updated_at DESC`,
      [workspaceId, userId],
    );
    return result.rows.map(mapSession);
  }
  async getSession(
    userId: string,
    sessionId: string,
    minimum: "viewer" | "editor",
  ) {
    const roles =
      minimum === "editor"
        ? ["owner", "admin", "editor"]
        : ["owner", "admin", "editor", "viewer"];
    const result = await this.pool.query(
      `SELECT s.* FROM agent_sessions s JOIN workspace_members m ON m.workspace_id=s.workspace_id WHERE s.id=$1 AND m.user_id=$2 AND m.role=ANY($3::text[])`,
      [sessionId, userId, roles],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }
  async createRun(run: AgentRunRecord, event: AgentRunEvent) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const allowed = await client.query(
        `SELECT s.id FROM agent_sessions s JOIN workspace_members m ON m.workspace_id=s.workspace_id
         WHERE s.id=$1 AND s.workspace_id=$2 AND m.user_id=$3 AND m.role IN ('owner','admin','editor') FOR SHARE OF s`,
        [run.sessionId, run.workspaceId, run.createdBy],
      );
      if (!allowed.rows[0])
        throw new DomainError(
          "AGENT_SESSION_NOT_FOUND",
          404,
          "Agent Session 不存在",
        );
      await insertRun(client, run);
      await insertEvent(client, event);
      await client.query(
        "UPDATE agent_sessions SET updated_at=$2 WHERE id=$1",
        [run.sessionId, run.updatedAt],
      );
      await client.query("COMMIT");
      return { run, events: [event], subtasks: [], results: [], approvals: [] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async listRuns(userId: string, sessionId: string) {
    const result = await this.pool.query(
      `SELECT r.* FROM agent_runs r JOIN workspace_members m ON m.workspace_id=r.workspace_id WHERE r.session_id=$1 AND m.user_id=$2 ORDER BY r.created_at DESC`,
      [sessionId, userId],
    );
    return result.rows.map(mapRun);
  }
  async getRun(userId: string, runId: string) {
    const allowed = await this.pool.query(
      `SELECT r.* FROM agent_runs r JOIN workspace_members m ON m.workspace_id=r.workspace_id WHERE r.id=$1 AND m.user_id=$2`,
      [runId, userId],
    );
    return allowed.rows[0]
      ? this.loadDetail(runId, mapRun(allowed.rows[0]))
      : null;
  }
  async cancel(userId: string, runId: string, now: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE agent_runs r SET status='cancelled',worker_id=NULL,lease_until=NULL,updated_at=$3,completed_at=$3 FROM workspace_members m WHERE r.id=$1 AND m.user_id=$2 AND m.workspace_id=r.workspace_id AND m.role IN ('owner','admin','editor') AND r.status NOT IN ('succeeded','failed','cancelled') RETURNING r.*`,
        [runId, userId, now],
      );
      if (!result.rows[0]) {
        const current = await this.getRun(userId, runId);
        if (
          current &&
          ["succeeded", "failed", "cancelled"].includes(current.run.status)
        ) {
          await client.query("ROLLBACK");
          return current;
        }
        throw new DomainError("AGENT_RUN_NOT_FOUND", 404, "Agent Run 不存在");
      }
      await appendNextEvent(client, runId, "run.cancelled", {}, now);
      await client.query("COMMIT");
      return this.loadDetail(runId, mapRun(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async retry(
    userId: string,
    runId: string,
    replacement: AgentRunRecord,
    event: AgentRunEvent,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const allowed = await client.query(
        `SELECT r.id FROM agent_runs r JOIN workspace_members m ON m.workspace_id=r.workspace_id WHERE r.id=$1 AND r.status='failed' AND m.user_id=$2 AND m.role IN ('owner','admin','editor') FOR UPDATE OF r`,
        [runId, userId],
      );
      if (!allowed.rows[0])
        throw new DomainError(
          "AGENT_RUN_NOT_RETRYABLE",
          409,
          "Agent Run 不可重试",
        );
      await insertRun(client, replacement);
      await insertEvent(client, event);
      await client.query("COMMIT");
      return {
        run: replacement,
        events: [event],
        subtasks: [],
        results: [],
        approvals: [],
      };
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
    const client = await this.pool.connect();
    let rows: Array<Record<string, unknown>> = [];
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `WITH due AS (SELECT id FROM agent_runs WHERE status='queued' OR (status IN ('claimed','running') AND lease_until<=$1) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $3)
         UPDATE agent_runs r SET status='claimed',worker_id=$2,lease_until=$4,last_heartbeat_at=$1,updated_at=$1 FROM due WHERE r.id=due.id RETURNING r.*`,
        [input.now, input.workerId, input.limit, input.leaseUntil],
      );
      rows = result.rows;
      for (const row of rows)
        await appendNextEvent(
          client,
          String(row.id),
          "run.claimed",
          { workerId: input.workerId },
          input.now,
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return Promise.all(
      rows.map((row) => this.loadDetail(String(row.id), mapRun(row))),
    );
  }
  async heartbeat(
    workerId: string,
    runIds: string[],
    now: string,
    leaseUntil: string,
  ) {
    const result = await this.pool.query(
      `UPDATE agent_runs SET last_heartbeat_at=$3,lease_until=$4 WHERE worker_id=$1 AND id=ANY($2::uuid[]) AND lease_until>$3 RETURNING id`,
      [workerId, runIds, now, leaseUntil],
    );
    return result.rowCount || 0;
  }
  async getLeased(workerId: string, runId: string, now: string) {
    const result = await this.pool.query(
      "SELECT * FROM agent_runs WHERE id=$1 AND worker_id=$2 AND lease_until>$3",
      [runId, workerId, now],
    );
    return result.rows[0]
      ? this.loadDetail(runId, mapRun(result.rows[0]))
      : null;
  }
  async saveWorker(input: {
    workerId: string;
    run: AgentRunRecord;
    events: AgentRunEvent[];
    subtasks: AgentRunSubtask[];
    results: AgentRunResult[];
    approvals: AgentRunApproval[];
    now: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const release = [
        "waiting_approval",
        "succeeded",
        "failed",
        "cancelled",
      ].includes(input.run.status);
      const result = await client.query(
        `UPDATE agent_runs SET plan=$4::jsonb,status=$5,error=$6::jsonb,updated_at=$3,completed_at=$7,worker_id=CASE WHEN $8 THEN NULL ELSE worker_id END,lease_until=CASE WHEN $8 THEN NULL ELSE lease_until END WHERE id=$1 AND worker_id=$2 AND lease_until>$3 RETURNING *`,
        [
          input.run.id,
          input.workerId,
          input.now,
          JSON.stringify(input.run.plan),
          input.run.status,
          JSON.stringify(input.run.error),
          input.run.completedAt,
          release,
        ],
      );
      if (!result.rows[0])
        throw new DomainError(
          "AGENT_RUN_LEASE_LOST",
          409,
          "Agent Run 租约已失效",
        );
      for (const value of input.events) await insertEvent(client, value, true);
      for (const value of input.subtasks) await upsertSubtask(client, value);
      for (const value of input.results) await insertResult(client, value);
      for (const value of input.approvals) await upsertApproval(client, value);
      await client.query("COMMIT");
      return this.loadDetail(input.run.id, mapRun(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async decideApproval(
    userId: string,
    approvalId: string,
    decision: "approved" | "declined",
    now: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE agent_run_approvals a SET status=$3,decided_by=$2,decided_at=$4 FROM agent_runs r,workspace_members m WHERE a.id=$1 AND a.status='pending' AND r.id=a.run_id AND m.workspace_id=r.workspace_id AND m.user_id=$2 AND m.role IN ('owner','admin','editor') RETURNING a.run_id`,
        [approvalId, userId, decision, now],
      );
      if (!result.rows[0])
        throw new DomainError(
          "AGENT_APPROVAL_NOT_FOUND",
          404,
          "Approval 不存在",
        );
      const runId = String(result.rows[0].run_id);
      const status = decision === "approved" ? "queued" : "failed";
      const error =
        decision === "declined"
          ? JSON.stringify({
              code: "APPROVAL_DECLINED",
              message: "用户拒绝了高风险操作",
            })
          : null;
      const run = await client.query(
        `UPDATE agent_runs SET status=$2,error=$3::jsonb,worker_id=NULL,lease_until=NULL,updated_at=$4,completed_at=CASE WHEN $2='failed' THEN $4 ELSE NULL END WHERE id=$1 RETURNING *`,
        [runId, status, error, now],
      );
      await appendNextEvent(
        client,
        runId,
        `approval.${decision}`,
        { approvalId },
        now,
      );
      await client.query("COMMIT");
      return this.loadDetail(runId, mapRun(run.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async loadDetail(runId: string, run: AgentRunRecord) {
    const [events, subtasks, results, approvals] = await Promise.all([
      this.pool.query(
        "SELECT * FROM agent_run_events WHERE run_id=$1 ORDER BY sequence",
        [runId],
      ),
      this.pool.query(
        "SELECT * FROM agent_run_subtasks WHERE run_id=$1 ORDER BY created_at",
        [runId],
      ),
      this.pool.query(
        "SELECT * FROM agent_run_results WHERE run_id=$1 ORDER BY created_at",
        [runId],
      ),
      this.pool.query(
        "SELECT * FROM agent_run_approvals WHERE run_id=$1 ORDER BY requested_at",
        [runId],
      ),
    ]);
    return {
      run,
      events: events.rows.map(mapEvent),
      subtasks: subtasks.rows.map(mapSubtask),
      results: results.rows.map(mapResult),
      approvals: approvals.rows.map(mapApproval),
    };
  }
}

function sessionValues(v: AgentSessionRecord) {
  return [
    v.id,
    v.workspaceId,
    v.projectId,
    v.createdBy,
    v.title,
    v.createdAt,
    v.updatedAt,
  ];
}
function runValues(v: AgentRunRecord) {
  return [
    v.id,
    v.sessionId,
    v.workspaceId,
    v.createdBy,
    v.prompt,
    JSON.stringify(v.attachments),
    v.modelId,
    JSON.stringify(v.parameters),
    JSON.stringify(v.skillPolicy),
    JSON.stringify(v.plan),
    v.status,
    v.attempt,
    v.maxAttempts,
    v.workerId,
    v.leaseUntil,
    v.lastHeartbeatAt,
    JSON.stringify(v.error),
    v.createdAt,
    v.updatedAt,
    v.completedAt,
  ];
}
async function insertRun(c: pg.PoolClient, v: AgentRunRecord) {
  await c.query(
    `INSERT INTO agent_runs(id,session_id,workspace_id,created_by,prompt,attachments,model_id,parameters,skill_policy,plan,status,attempt,max_attempts,worker_id,lease_until,last_heartbeat_at,error,created_at,updated_at,completed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)`,
    runValues(v),
  );
}
async function insertEvent(
  c: pg.Pool | pg.PoolClient,
  v: AgentRunEvent,
  ignore = false,
) {
  await c.query(
    `INSERT INTO agent_run_events(run_id,sequence,type,data,created_at) VALUES($1,$2,$3,$4::jsonb,$5) ${ignore ? "ON CONFLICT DO NOTHING" : ""}`,
    [v.runId, v.sequence, v.type, JSON.stringify(v.data), v.createdAt],
  );
}
async function appendNextEvent(
  c: pg.Pool | pg.PoolClient,
  runId: string,
  type: string,
  data: Record<string, unknown>,
  now: string,
) {
  await c.query(
    `INSERT INTO agent_run_events(run_id,sequence,type,data,created_at) SELECT $1,COALESCE(max(sequence),0)+1,$2,$3::jsonb,$4 FROM agent_run_events WHERE run_id=$1`,
    [runId, type, JSON.stringify(data), now],
  );
}
async function upsertSubtask(c: pg.PoolClient, v: AgentRunSubtask) {
  await c.query(
    `INSERT INTO agent_run_subtasks(id,run_id,kind,title,status,input,output,error,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,output=EXCLUDED.output,error=EXCLUDED.error,updated_at=EXCLUDED.updated_at`,
    [
      v.id,
      v.runId,
      v.kind,
      v.title,
      v.status,
      JSON.stringify(v.input),
      JSON.stringify(v.output),
      JSON.stringify(v.error),
      v.createdAt,
      v.updatedAt,
    ],
  );
}
async function insertResult(c: pg.PoolClient, v: AgentRunResult) {
  await c.query(
    `INSERT INTO agent_run_results(id,run_id,kind,payload,asset_id,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT DO NOTHING`,
    [v.id, v.runId, v.kind, JSON.stringify(v.payload), v.assetId, v.createdAt],
  );
}
async function upsertApproval(c: pg.PoolClient, v: AgentRunApproval) {
  await c.query(
    `INSERT INTO agent_run_approvals(id,run_id,action,status,request,requested_at,decided_by,decided_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,decided_by=EXCLUDED.decided_by,decided_at=EXCLUDED.decided_at`,
    [
      v.id,
      v.runId,
      v.action,
      v.status,
      JSON.stringify(v.request),
      v.requestedAt,
      v.decidedBy,
      v.decidedAt,
    ],
  );
}
function mapSession(r: Record<string, unknown>): AgentSessionRecord {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    projectId: r.project_id ? String(r.project_id) : null,
    createdBy: String(r.created_by),
    title: String(r.title),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function mapRun(r: Record<string, unknown>): AgentRunRecord {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    workspaceId: String(r.workspace_id),
    createdBy: String(r.created_by),
    prompt: String(r.prompt),
    attachments: r.attachments as AgentRunRecord["attachments"],
    modelId: r.model_id ? String(r.model_id) : null,
    parameters: r.parameters as Record<string, unknown>,
    skillPolicy: r.skill_policy as Record<string, unknown>,
    plan: r.plan,
    status: r.status as AgentRunRecord["status"],
    attempt: Number(r.attempt),
    maxAttempts: Number(r.max_attempts),
    workerId: r.worker_id ? String(r.worker_id) : null,
    leaseUntil: r.lease_until ? iso(r.lease_until) : null,
    lastHeartbeatAt: r.last_heartbeat_at ? iso(r.last_heartbeat_at) : null,
    error: r.error as AgentRunRecord["error"],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    completedAt: r.completed_at ? iso(r.completed_at) : null,
  };
}
function mapEvent(r: Record<string, unknown>): AgentRunEvent {
  return {
    runId: String(r.run_id),
    sequence: Number(r.sequence),
    type: String(r.type),
    data: r.data as Record<string, unknown>,
    createdAt: iso(r.created_at),
  };
}
function mapSubtask(r: Record<string, unknown>): AgentRunSubtask {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    kind: String(r.kind),
    title: String(r.title),
    status: r.status as AgentRunSubtask["status"],
    input: r.input,
    output: r.output,
    error: r.error,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function mapResult(r: Record<string, unknown>): AgentRunResult {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    kind: r.kind as AgentRunResult["kind"],
    payload: r.payload as Record<string, unknown>,
    assetId: r.asset_id ? String(r.asset_id) : null,
    createdAt: iso(r.created_at),
  };
}
function mapApproval(r: Record<string, unknown>): AgentRunApproval {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    action: r.action as AgentRunApproval["action"],
    status: r.status as AgentRunApproval["status"],
    request: r.request as Record<string, unknown>,
    requestedAt: iso(r.requested_at),
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
  };
}
function iso(v: unknown) {
  return v instanceof Date ? v.toISOString() : String(v);
}
