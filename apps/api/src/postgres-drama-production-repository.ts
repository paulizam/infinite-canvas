import pg from "pg";
import { DomainError } from "./domain.js";
import type {
  DramaProductionRepository,
  ProductionMutation,
  ProductionState,
  ShotGeneration,
  TimelineItem,
  ShotReview,
} from "./drama-production-repository.js";
export class PostgresDramaProductionRepository implements DramaProductionRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async get(userId: string, id: string) {
    const q = await this.pool.query(
      "SELECT p.workspace_id FROM drama_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id WHERE p.id=$1 AND m.user_id=$2",
      [id, userId],
    );
    if (!q.rows[0])
      throw new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
    return state(this.pool, id);
  }
  async mutate(
    userId: string,
    id: string,
    expected: number,
    key: string,
    hash: string,
    m: ProductionMutation,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT p.*,m.role FROM drama_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id AND m.user_id=$2 WHERE p.id=$1 FOR UPDATE OF p",
        [id, userId],
      );
      if (!q.rows[0])
        throw new DomainError("DRAMA_NOT_FOUND", 404, "短剧项目不存在");
      if (!["owner", "admin", "editor"].includes(q.rows[0].role))
        throw new DomainError("FORBIDDEN", 403, "空间权限不足");
      const old = await c.query(
        "SELECT request_hash,resulting_revision FROM drama_mutations WHERE project_id=$1 AND mutation_id=$2",
        [id, key],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash)
          throw new DomainError(
            "DRAMA_IDEMPOTENCY_CONFLICT",
            409,
            "幂等键内容漂移",
          );
        await c.query("COMMIT");
        return {
          revision: old.rows[0].resulting_revision,
          state: await state(c, id),
          replayed: true,
        };
      }
      if (q.rows[0].revision !== expected)
        throw new DomainError("REVISION_CONFLICT", 409, "短剧项目版本冲突");
      const w = q.rows[0].workspace_id;
      if (m.type === "generation") {
        const x = m.record;
        await c.query(
          "INSERT INTO drama_shot_generations(id,project_id,workspace_id,shot_id,generation_job_id,capability,selected_asset_id,selected,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            x.id,
            id,
            w,
            x.shotId,
            x.generationJobId,
            x.capability,
            x.selectedAssetId,
            x.selected,
            x.createdBy,
            x.createdAt,
          ],
        );
      } else if (m.type === "timeline") {
        const x = m.record;
        await c.query(
          "INSERT INTO drama_timeline_items(id,project_id,workspace_id,shot_id,kind,text_content,voice,asset_id,start_ms,end_ms,sort_order,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [
            x.id,
            id,
            w,
            x.shotId,
            x.kind,
            x.textContent,
            x.voice,
            x.assetId,
            x.startMs,
            x.endMs,
            x.sortOrder,
            x.createdBy,
            x.createdAt,
          ],
        );
      } else if (m.type === "review") {
        const x = m.record;
        await c.query(
          "INSERT INTO drama_shot_reviews(id,project_id,workspace_id,shot_id,status,comment,reviewer_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            x.id,
            id,
            w,
            x.shotId,
            x.status,
            x.comment,
            x.reviewerId,
            x.createdAt,
          ],
        );
      } else {
        const target = await c.query(
          "SELECT shot_id FROM drama_shot_generations WHERE id=$1 AND project_id=$2",
          [m.generationId, id],
        );
        if (!target.rows[0])
          throw new DomainError(
            "DRAMA_GENERATION_NOT_FOUND",
            404,
            "镜头生成记录不存在",
          );
        await c.query(
          "UPDATE drama_shot_generations SET selected=false WHERE shot_id=$1",
          [target.rows[0].shot_id],
        );
        await c.query(
          "UPDATE drama_shot_generations SET selected=true,selected_asset_id=$2 WHERE id=$1",
          [m.generationId, m.assetId],
        );
      }
      const now = new Date().toISOString();
      await c.query(
        "UPDATE drama_projects SET revision=revision+1,updated_at=$2 WHERE id=$1",
        [id, now],
      );
      await c.query(
        "INSERT INTO drama_mutations(project_id,mutation_id,request_hash,resulting_revision,created_at) VALUES($1,$2,$3,$4,$5)",
        [id, key, hash, expected + 1, now],
      );
      await c.query("COMMIT");
      return {
        revision: expected + 1,
        state: await state(c, id),
        replayed: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
type Db = {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }>;
};
async function state(db: Db, id: string): Promise<ProductionState> {
  const [g, t, r] = await Promise.all([
    db.query(
      "SELECT * FROM drama_shot_generations WHERE project_id=$1 ORDER BY created_at DESC",
      [id],
    ),
    db.query(
      "SELECT * FROM drama_timeline_items WHERE project_id=$1 ORDER BY start_ms,sort_order",
      [id],
    ),
    db.query(
      "SELECT * FROM drama_shot_reviews WHERE project_id=$1 ORDER BY created_at DESC",
      [id],
    ),
  ]);
  return {
    generations: g.rows.map(gen),
    timeline: t.rows.map(item),
    reviews: r.rows.map(review),
  };
}
const iso = (x: unknown) => new Date(x as string).toISOString();
const gen = (x: any): ShotGeneration => ({
  id: x.id,
  projectId: x.project_id,
  workspaceId: x.workspace_id,
  shotId: x.shot_id,
  generationJobId: x.generation_job_id,
  capability: x.capability,
  selectedAssetId: x.selected_asset_id,
  selected: x.selected,
  createdBy: x.created_by,
  createdAt: iso(x.created_at),
});
const item = (x: any): TimelineItem => ({
  id: x.id,
  projectId: x.project_id,
  workspaceId: x.workspace_id,
  shotId: x.shot_id,
  kind: x.kind,
  textContent: x.text_content,
  voice: x.voice,
  assetId: x.asset_id,
  startMs: x.start_ms,
  endMs: x.end_ms,
  sortOrder: x.sort_order,
  createdBy: x.created_by,
  createdAt: iso(x.created_at),
});
const review = (x: any): ShotReview => ({
  id: x.id,
  projectId: x.project_id,
  workspaceId: x.workspace_id,
  shotId: x.shot_id,
  status: x.status,
  comment: x.comment,
  reviewerId: x.reviewer_id,
  createdAt: iso(x.created_at),
});
