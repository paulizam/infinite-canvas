import pg from "pg";
import type {
  GenerationJob,
  GenerationJobPhase,
} from "@infinite-canvas/contracts";
import { DomainError } from "./domain.js";
import type { GenerationJobRepository } from "./generation-job-repository.js";
import {
  isTerminalGenerationPhase,
  transitionGenerationJob,
  type GenerationJobTransitionPatch,
} from "./generation-job-state.js";

export class PostgresGenerationJobRepository implements GenerationJobRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async create(job: GenerationJob) {
    const inserted = await this.pool.query(
      `${insertJobSql()} ON CONFLICT(workspace_id,owner_id,client_request_id,attempt) DO NOTHING RETURNING *`,
      jobValues(job),
    );
    if (inserted.rows[0])
      return { job: mapJob(inserted.rows[0]), replayed: false };
    const existing = await this.pool.query(
      "SELECT * FROM generation_jobs WHERE workspace_id=$1 AND owner_id=$2 AND client_request_id=$3 AND attempt=$4",
      [job.workspaceId, job.ownerId, job.clientRequestId, job.attempt],
    );
    return { job: mapJob(existing.rows[0]), replayed: true };
  }
  async getForUser(userId: string, jobId: string) {
    const result = await this.pool.query(
      "SELECT * FROM generation_jobs WHERE id=$1 AND owner_id=$2",
      [jobId, userId],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }
  async listForUser(userId: string, workspaceId: string) {
    const result = await this.pool.query(
      "SELECT * FROM generation_jobs WHERE owner_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 200",
      [userId, workspaceId],
    );
    return result.rows.map(mapJob);
  }
  cancel(userId: string, jobId: string, now: string) {
    return this.userTransition(userId, jobId, now, (job) => {
      if (job.phase === "cancel_requested" || job.phase === "cancelled")
        return job;
      if (isTerminalGenerationPhase(job.phase))
        throw new DomainError("JOB_NOT_CANCELLABLE", 409, "终态任务不能取消");
      return transitionGenerationJob(
        job,
        "cancel_requested",
        { nextRunAt: now },
        now,
      );
    });
  }
  async retry(userId: string, jobId: string, newId: string, now: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM generation_jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [jobId, userId],
      );
      if (!result.rows[0])
        throw new DomainError("JOB_NOT_FOUND", 404, "生成任务不存在");
      const source = mapJob(result.rows[0]);
      if (
        source.phase !== "failed" &&
        source.phase !== "cancelled" &&
        source.phase !== "needs_review"
      )
        throw new DomainError(
          "JOB_NOT_RETRYABLE",
          409,
          "仅失败、取消或待复核任务可重试",
        );
      const next: GenerationJob = {
        ...source,
        id: newId,
        attempt: source.attempt + 1,
        retryOf: source.id,
        status: "queued",
        phase: "queued",
        result: null,
        upstreamTaskId: null,
        provider: null,
        channelId: null,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        nextRunAt: now,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      const inserted = await client.query(
        `${insertJobSql()} RETURNING *`,
        jobValues(next),
      );
      await client.query("COMMIT");
      return mapJob(inserted.rows[0]);
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
      `WITH due AS (
        SELECT id FROM generation_jobs
        WHERE phase = ANY($4::text[]) AND next_run_at <= $1
          AND (lease_until IS NULL OR lease_until <= $1)
        ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT $3
      )
      UPDATE generation_jobs j SET
        phase=CASE WHEN j.phase='queued' THEN 'claimed' ELSE j.phase END,
        status='running',worker_id=$2,lease_until=$5,last_heartbeat_at=$1,updated_at=$1
      FROM due WHERE j.id=due.id RETURNING j.*`,
      [
        input.now,
        input.workerId,
        input.limit,
        claimablePhases,
        input.leaseUntil,
      ],
    );
    return result.rows.map(mapJob);
  }
  async transitionByWorker(input: {
    workerId: string;
    jobId: string;
    phase: GenerationJobPhase;
    patch: GenerationJobTransitionPatch;
    now: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM generation_jobs WHERE id=$1 AND worker_id=$2 AND lease_until>$3 FOR UPDATE",
        [input.jobId, input.workerId, input.now],
      );
      if (!result.rows[0])
        throw new DomainError("JOB_LEASE_LOST", 409, "任务租约已失效");
      const updated = transitionGenerationJob(
        mapJob(result.rows[0]),
        input.phase,
        input.patch,
        input.now,
      );
      await updateJob(client, updated);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async heartbeat(
    workerId: string,
    jobIds: string[],
    now: string,
    leaseUntil: string,
  ) {
    if (!jobIds.length) return 0;
    const result = await this.pool.query(
      "UPDATE generation_jobs SET lease_until=$4,last_heartbeat_at=$3,updated_at=$3 WHERE worker_id=$1 AND id=ANY($2::uuid[]) AND lease_until>$3",
      [workerId, [...new Set(jobIds)], now, leaseUntil],
    );
    return result.rowCount || 0;
  }
  private async userTransition(
    userId: string,
    jobId: string,
    now: string,
    change: (job: GenerationJob) => GenerationJob,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM generation_jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [jobId, userId],
      );
      if (!result.rows[0])
        throw new DomainError("JOB_NOT_FOUND", 404, "生成任务不存在");
      const updated = change(mapJob(result.rows[0]));
      await updateJob(client, updated);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const claimablePhases: GenerationJobPhase[] = [
  "queued",
  "claimed",
  "submitting",
  "submitted",
  "polling",
  "result_ready",
  "persisting",
  "cancel_requested",
];
function insertJobSql() {
  return `INSERT INTO generation_jobs(id,workspace_id,owner_id,capability,logical_model_id,client_request_id,attempt,retry_of,status,phase,input,result,upstream_task_id,provider,channel_id,worker_id,lease_until,last_heartbeat_at,next_run_at,error_code,error_message,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`;
}
function jobValues(j: GenerationJob) {
  return [
    j.id,
    j.workspaceId,
    j.ownerId,
    j.capability,
    j.logicalModelId,
    j.clientRequestId,
    j.attempt,
    j.retryOf,
    j.status,
    j.phase,
    JSON.stringify(j.input),
    j.result ? JSON.stringify(j.result) : null,
    j.upstreamTaskId,
    j.provider,
    j.channelId,
    j.workerId,
    j.leaseUntil,
    j.lastHeartbeatAt,
    j.nextRunAt,
    j.errorCode,
    j.errorMessage,
    j.createdAt,
    j.updatedAt,
  ];
}
async function updateJob(client: pg.PoolClient, j: GenerationJob) {
  await client.query(
    `UPDATE generation_jobs SET status=$2,phase=$3,result=$4::jsonb,upstream_task_id=$5,provider=$6,channel_id=$7,worker_id=$8,lease_until=$9,last_heartbeat_at=$10,next_run_at=$11,error_code=$12,error_message=$13,updated_at=$14 WHERE id=$1`,
    [
      j.id,
      j.status,
      j.phase,
      j.result ? JSON.stringify(j.result) : null,
      j.upstreamTaskId,
      j.provider,
      j.channelId,
      j.workerId,
      j.leaseUntil,
      j.lastHeartbeatAt,
      j.nextRunAt,
      j.errorCode,
      j.errorMessage,
      j.updatedAt,
    ],
  );
}
function mapJob(row: Record<string, unknown>): GenerationJob {
  const iso = (value: unknown) =>
    value instanceof Date ? value.toISOString() : String(value);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    ownerId: String(row.owner_id),
    capability: row.capability as GenerationJob["capability"],
    logicalModelId: String(row.logical_model_id),
    clientRequestId: String(row.client_request_id),
    attempt: Number(row.attempt),
    retryOf: row.retry_of ? String(row.retry_of) : null,
    status: row.status as GenerationJob["status"],
    phase: row.phase as GenerationJobPhase,
    input: row.input as Record<string, unknown>,
    result: row.result as Record<string, unknown> | null,
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    provider: row.provider ? String(row.provider) : null,
    channelId: row.channel_id ? String(row.channel_id) : null,
    workerId: row.worker_id ? String(row.worker_id) : null,
    leaseUntil: row.lease_until ? iso(row.lease_until) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? iso(row.last_heartbeat_at) : null,
    nextRunAt: iso(row.next_run_at),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
