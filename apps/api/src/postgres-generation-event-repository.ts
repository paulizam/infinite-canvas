import pg from "pg";
import type { GenerationEventType } from "@infinite-canvas/contracts";
import type { GenerationEventRepository } from "./generation-event-repository.js";

export class PostgresGenerationEventRepository implements GenerationEventRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async append(
    jobId: string,
    type: GenerationEventType,
    payload: Record<string, unknown>,
    now: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [jobId],
      );
      const result = await client.query(
        `INSERT INTO generation_events(job_id,event_id,event_type,payload,created_at)
         SELECT $1, COALESCE(MAX(event_id),0)+1, $2, $3::jsonb, $4 FROM generation_events WHERE job_id=$1
         RETURNING *`,
        [jobId, type, JSON.stringify(payload), now],
      );
      await client.query("COMMIT");
      return mapEvent(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async listForUser(
    userId: string,
    jobId: string,
    afterId: number,
    limit: number,
  ) {
    const result = await this.pool.query(
      `SELECT e.* FROM generation_events e JOIN generation_jobs j ON j.id=e.job_id
       WHERE e.job_id=$1 AND j.owner_id=$2 AND e.event_id>$3 ORDER BY e.event_id LIMIT $4`,
      [jobId, userId, afterId, limit],
    );
    return result.rows.map(mapEvent);
  }
}

function mapEvent(row: Record<string, unknown>) {
  return {
    id: Number(row.event_id),
    jobId: String(row.job_id),
    type: String(row.event_type) as GenerationEventType,
    payload: row.payload as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
