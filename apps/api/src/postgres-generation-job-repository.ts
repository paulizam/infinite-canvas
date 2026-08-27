import pg from "pg";
import { randomUUID } from "node:crypto";
import type {
  GenerationJob,
  GenerationJobPhase,
} from "@infinite-canvas/contracts";
import { DomainError } from "./domain.js";
import {
  estimatePrice,
  type BillingPriceRule,
  type GenerationJobRepository,
} from "./generation-job-repository.js";
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT * FROM generation_jobs WHERE workspace_id=$1 AND owner_id=$2 AND client_request_id=$3 AND attempt=$4 FOR UPDATE",
        [job.workspaceId, job.ownerId, job.clientRequestId, job.attempt],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { job: mapJob(existing.rows[0]), replayed: true };
      }
      const billed = await this.reserveWithClient(client, job);
      const inserted = await client.query(
        `${insertJobSql()} RETURNING *`,
        jobValues(billed),
      );
      await client.query("COMMIT");
      return { job: mapJob(inserted.rows[0]), replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        const existing = await this.pool.query(
          "SELECT * FROM generation_jobs WHERE workspace_id=$1 AND owner_id=$2 AND client_request_id=$3 AND attempt=$4",
          [job.workspaceId, job.ownerId, job.clientRequestId, job.attempt],
        );
        if (existing.rows[0])
          return { job: mapJob(existing.rows[0]), replayed: true };
      }
      throw error;
    } finally {
      client.release();
    }
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
        billing: {
          state: "free",
          estimatedUnits: 0,
          reservedUnits: 0,
          actualUnits: null,
        },
        createdAt: now,
        updatedAt: now,
      };
      const billed = await this.reserveWithClient(client, next);
      const inserted = await client.query(
        `${insertJobSql()} RETURNING *`,
        jobValues(billed),
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
    patch: GenerationJobTransitionPatch & { billingActualUnits?: number };
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
      const { billingActualUnits, ...statePatch } = input.patch;
      const updated = transitionGenerationJob(
        mapJob(result.rows[0]),
        input.phase,
        statePatch,
        input.now,
      );
      await this.settleTerminal(client, updated, input.now, billingActualUnits);
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
  async getForWorker(workerId: string, jobId: string, now: string) {
    const result = await this.pool.query(
      "SELECT * FROM generation_jobs WHERE id=$1 AND worker_id=$2 AND lease_until>$3",
      [jobId, workerId, now],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
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
  async recordWorkerHeartbeat(workerId: string, now: string) {
    await this.pool.query(
      `INSERT INTO generation_worker_heartbeats(worker_id,last_seen_at,started_at)
       VALUES($1,$2,$2) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at`,
      [workerId, now],
    );
  }
  async latestWorkerHeartbeat() {
    const result = await this.pool.query(
      "SELECT max(last_seen_at) AS last_seen_at FROM generation_worker_heartbeats",
    );
    const value = result.rows[0]?.last_seen_at as Date | string | null;
    return value
      ? value instanceof Date
        ? value.toISOString()
        : String(value)
      : null;
  }
  async estimate(
    logicalModelId: string,
    capability: GenerationJob["capability"],
    parameters: Record<string, unknown>,
  ) {
    const rule = await this.priceRule(this.pool, logicalModelId, capability);
    return estimatePrice(
      logicalModelId,
      capability,
      parameters,
      rule || undefined,
    );
  }
  async getWallet(userId: string) {
    const result = await this.pool.query(
      "SELECT * FROM billing_wallets WHERE user_id=$1",
      [userId],
    );
    return result.rows[0]
      ? mapWallet(result.rows[0])
      : { userId, balanceUnits: 0, updatedAt: new Date(0).toISOString() };
  }
  async listLedger(userId: string, limit: number) {
    const result = await this.pool.query(
      "SELECT * FROM billing_ledger_entries WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2",
      [userId, limit],
    );
    return result.rows.map(mapLedger);
  }
  async adjustWallet(input: {
    userId: string;
    amountUnits: number;
    idempotencyKey: string;
    note: string;
    now: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const replay = await client.query(
        "SELECT 1 FROM billing_ledger_entries WHERE idempotency_key=$1",
        [input.idempotencyKey],
      );
      if (replay.rows[0]) {
        const wallet = await this.walletWithClient(
          client,
          input.userId,
          input.now,
        );
        await client.query("COMMIT");
        return wallet;
      }
      const wallet = await this.walletWithClient(
        client,
        input.userId,
        input.now,
      );
      const racedReplay = await client.query(
        "SELECT 1 FROM billing_ledger_entries WHERE idempotency_key=$1",
        [input.idempotencyKey],
      );
      if (racedReplay.rows[0]) {
        await client.query("COMMIT");
        return wallet;
      }
      const balance = wallet.balanceUnits + input.amountUnits;
      if (balance < 0)
        throw new DomainError("INSUFFICIENT_POINTS", 409, "积分余额不足");
      await this.writeWalletAndLedger(client, {
        userId: input.userId,
        jobId: null,
        type: "adjustment",
        amountUnits: input.amountUnits,
        balanceUnits: balance,
        idempotencyKey: input.idempotencyKey,
        metadata: { note: input.note },
        now: input.now,
      });
      await client.query("COMMIT");
      return {
        userId: input.userId,
        balanceUnits: balance,
        updatedAt: input.now,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async savePriceRule(rule: BillingPriceRule) {
    const result = await this.pool.query(
      `INSERT INTO billing_price_rules(logical_model_id,capability,base_units,multiplier_config,enabled,updated_at)
       VALUES($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT(logical_model_id,capability) DO UPDATE SET base_units=$3,multiplier_config=$4::jsonb,enabled=$5,updated_at=$6 RETURNING *`,
      [
        rule.logicalModelId,
        rule.capability,
        rule.baseUnits,
        JSON.stringify(rule.multiplierConfig),
        rule.enabled,
        rule.updatedAt,
      ],
    );
    return mapPriceRule(result.rows[0]);
  }
  private async reserveWithClient(client: pg.PoolClient, job: GenerationJob) {
    const rule = await this.priceRule(
      client,
      job.logicalModelId,
      job.capability,
    );
    const estimate = estimatePrice(
      job.logicalModelId,
      job.capability,
      job.input,
      rule || undefined,
    );
    if (!estimate.estimatedUnits)
      return {
        ...job,
        billing: {
          state: "free" as const,
          estimatedUnits: 0,
          reservedUnits: 0,
          actualUnits: null,
        },
      };
    const wallet = await this.walletWithClient(
      client,
      job.ownerId,
      job.createdAt,
    );
    if (wallet.balanceUnits < estimate.estimatedUnits)
      throw new DomainError("INSUFFICIENT_POINTS", 409, "积分余额不足");
    const balance = wallet.balanceUnits - estimate.estimatedUnits;
    await this.writeWalletAndLedger(client, {
      userId: job.ownerId,
      jobId: job.id,
      type: "reserve",
      amountUnits: -estimate.estimatedUnits,
      balanceUnits: balance,
      idempotencyKey: `job:${job.id}:reserve`,
      metadata: { estimate },
      now: job.createdAt,
    });
    return {
      ...job,
      billing: {
        state: "reserved" as const,
        estimatedUnits: estimate.estimatedUnits,
        reservedUnits: estimate.estimatedUnits,
        actualUnits: null,
      },
    };
  }
  private async settleTerminal(
    client: pg.PoolClient,
    job: GenerationJob,
    now: string,
    actualInput?: number,
  ) {
    if (job.billing.state !== "reserved") return;
    if (job.phase === "succeeded") {
      const wallet = await this.walletWithClient(client, job.ownerId, now);
      const actual =
        actualInput === undefined
          ? job.billing.reservedUnits
          : checkedUnits(actualInput);
      const delta = job.billing.reservedUnits - actual;
      const balance = wallet.balanceUnits + delta;
      if (balance < 0)
        throw new DomainError(
          "INSUFFICIENT_POINTS_AT_SETTLEMENT",
          409,
          "实际用量超过预留且余额不足",
        );
      if (delta)
        await client.query(
          "UPDATE billing_wallets SET balance_units=$2,updated_at=$3 WHERE user_id=$1",
          [job.ownerId, balance, now],
        );
      await this.insertLedger(client, {
        userId: job.ownerId,
        jobId: job.id,
        type: "settle",
        amountUnits: delta,
        balanceUnits: balance,
        idempotencyKey: `job:${job.id}:settle`,
        metadata: {},
        now,
      });
      job.billing = {
        ...job.billing,
        state: "settled",
        actualUnits: actual,
      };
    } else if (job.phase === "failed" || job.phase === "cancelled") {
      const wallet = await this.walletWithClient(client, job.ownerId, now);
      const balance = wallet.balanceUnits + job.billing.reservedUnits;
      await this.writeWalletAndLedger(client, {
        userId: job.ownerId,
        jobId: job.id,
        type: "refund",
        amountUnits: job.billing.reservedUnits,
        balanceUnits: balance,
        idempotencyKey: `job:${job.id}:refund`,
        metadata: {},
        now,
      });
      job.billing = { ...job.billing, state: "refunded", actualUnits: 0 };
    } else if (job.phase === "needs_review")
      job.billing = { ...job.billing, state: "needs_review" };
  }
  private async priceRule(
    client: pg.Pool | pg.PoolClient,
    logicalModelId: string,
    capability: GenerationJob["capability"],
  ) {
    const result = await client.query(
      "SELECT * FROM billing_price_rules WHERE lower(logical_model_id)=lower($1) AND capability=$2 AND enabled",
      [logicalModelId, capability],
    );
    return result.rows[0] ? mapPriceRule(result.rows[0]) : null;
  }
  private async walletWithClient(
    client: pg.PoolClient,
    userId: string,
    now: string,
  ) {
    await client.query(
      `INSERT INTO billing_wallets(user_id,balance_units,created_at,updated_at)
       VALUES($1,0,$2,$2) ON CONFLICT(user_id) DO NOTHING`,
      [userId, now],
    );
    const result = await client.query(
      "SELECT * FROM billing_wallets WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    return mapWallet(result.rows[0]);
  }
  private async writeWalletAndLedger(
    client: pg.PoolClient,
    input: LedgerWrite,
  ) {
    await client.query(
      "UPDATE billing_wallets SET balance_units=$2,updated_at=$3 WHERE user_id=$1",
      [input.userId, input.balanceUnits, input.now],
    );
    await this.insertLedger(client, input);
  }
  private async insertLedger(client: pg.PoolClient, input: LedgerWrite) {
    await client.query(
      `INSERT INTO billing_ledger_entries(id,user_id,job_id,entry_type,amount_units,balance_after_units,idempotency_key,metadata,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        input.userId,
        input.jobId,
        input.type,
        input.amountUnits,
        input.balanceUnits,
        input.idempotencyKey,
        JSON.stringify(input.metadata),
        input.now,
      ],
    );
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
type LedgerWrite = {
  userId: string;
  jobId: string | null;
  type: "reserve" | "settle" | "refund" | "adjustment";
  amountUnits: number;
  balanceUnits: number;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  now: string;
};
function insertJobSql() {
  return `INSERT INTO generation_jobs(id,workspace_id,owner_id,capability,logical_model_id,client_request_id,attempt,retry_of,status,phase,input,result,upstream_task_id,provider,channel_id,worker_id,lease_until,last_heartbeat_at,next_run_at,error_code,error_message,created_at,updated_at,billing_state,estimated_units,reserved_units,actual_units)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`;
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
    j.billing.state,
    j.billing.estimatedUnits,
    j.billing.reservedUnits,
    j.billing.actualUnits,
  ];
}
async function updateJob(client: pg.PoolClient, j: GenerationJob) {
  await client.query(
    `UPDATE generation_jobs SET status=$2,phase=$3,result=$4::jsonb,upstream_task_id=$5,provider=$6,channel_id=$7,worker_id=$8,lease_until=$9,last_heartbeat_at=$10,next_run_at=$11,error_code=$12,error_message=$13,updated_at=$14,billing_state=$15,estimated_units=$16,reserved_units=$17,actual_units=$18 WHERE id=$1`,
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
      j.billing.state,
      j.billing.estimatedUnits,
      j.billing.reservedUnits,
      j.billing.actualUnits,
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
    billing: {
      state: (row.billing_state || "free") as GenerationJob["billing"]["state"],
      estimatedUnits: Number(row.estimated_units || 0),
      reservedUnits: Number(row.reserved_units || 0),
      actualUnits:
        row.actual_units === null || row.actual_units === undefined
          ? null
          : Number(row.actual_units),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapWallet(row: Record<string, unknown>) {
  return {
    userId: String(row.user_id),
    balanceUnits: Number(row.balance_units),
    updatedAt: toIso(row.updated_at),
  };
}
function mapLedger(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    jobId: row.job_id ? String(row.job_id) : null,
    type: row.entry_type as "reserve" | "settle" | "refund" | "adjustment",
    amountUnits: Number(row.amount_units),
    balanceAfterUnits: Number(row.balance_after_units),
    idempotencyKey: String(row.idempotency_key),
    metadata: row.metadata as Record<string, unknown>,
    createdAt: toIso(row.created_at),
  };
}
function mapPriceRule(row: Record<string, unknown>): BillingPriceRule {
  return {
    logicalModelId: String(row.logical_model_id),
    capability: row.capability as GenerationJob["capability"],
    baseUnits: Number(row.base_units),
    multiplierConfig: row.multiplier_config as Record<string, unknown>,
    enabled: Boolean(row.enabled),
    updatedAt: toIso(row.updated_at),
  };
}
function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
function checkedUnits(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DomainError("BILLING_ACTUAL_INVALID", 400, "实际积分用量无效");
  return value;
}
