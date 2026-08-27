import pg from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  CommunityRepository,
  CommunityView,
  CommunityWork,
  CommunityVersion,
} from "./community-repository.js";
export class PostgresCommunityRepository implements CommunityRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async listOwned(u: string, w: string) {
    await role(this.pool, u, w, "viewer");
    const r = await this.pool.query(
      "SELECT * FROM community_works WHERE owner_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC",
      [u, w],
    );
    return r.rows.map(work);
  }
  async create(u: string, x: CommunityWork) {
    await role(this.pool, u, x.workspaceId, "editor");
    await this.pool.query(
      "INSERT INTO community_works(id,workspace_id,owner_id,source_project_id,title,description,cover_asset_id,tags,visibility,status,revision,draft_snapshot,moderation_reason,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',0,$10::jsonb,'',$11,$11)",
      [
        x.id,
        x.workspaceId,
        u,
        x.sourceProjectId,
        x.title,
        x.description,
        x.coverAssetId,
        x.tags,
        x.visibility,
        JSON.stringify(x.draftSnapshot),
        x.createdAt,
      ],
    );
    return x;
  }
  async mutate(
    u: string,
    id: string,
    expected: number,
    key: string,
    hash: string,
    patch: any,
    submit: boolean,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT * FROM community_works WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, u],
      );
      if (!q.rows[0]) throw missing();
      const old = await c.query(
        "SELECT request_hash FROM community_work_mutations WHERE project_id=$1 AND mutation_id=$2",
        [id, key],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash) throw conflict();
        await c.query("COMMIT");
        return { work: work(q.rows[0]), replayed: true };
      }
      if (q.rows[0].revision !== expected) throw revision();
      if (!["draft", "rejected"].includes(q.rows[0].status)) throw locked();
      const x = {
        ...work(q.rows[0]),
        ...patch,
        status: submit ? "pending" : q.rows[0].status,
        revision: expected + 1,
        moderationReason: submit ? "" : q.rows[0].moderation_reason,
        updatedAt: new Date().toISOString(),
      };
      await c.query(
        "UPDATE community_works SET title=$2,description=$3,cover_asset_id=$4,tags=$5,visibility=$6,status=$7,revision=$8,draft_snapshot=$9::jsonb,moderation_reason=$10,updated_at=$11 WHERE id=$1",
        [
          id,
          x.title,
          x.description,
          x.coverAssetId,
          x.tags,
          x.visibility,
          x.status,
          x.revision,
          JSON.stringify(x.draftSnapshot),
          x.moderationReason,
          x.updatedAt,
        ],
      );
      await c.query(
        "INSERT INTO community_work_mutations(project_id,mutation_id,request_hash,resulting_revision,created_at) VALUES($1,$2,$3,$4,$5)",
        [id, key, hash, x.revision, x.updatedAt],
      );
      await c.query("COMMIT");
      return { work: x, replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async feed(i: {
    query?: string;
    tag?: string;
    cursor?: string;
    limit: number;
  }) {
    const r = await this.pool.query(
      "SELECT * FROM community_works WHERE status='published' AND visibility='public' AND ($1::text IS NULL OR title ILIKE '%'||$1||'%' OR description ILIKE '%'||$1||'%') AND ($2::text IS NULL OR $2=ANY(tags)) AND ($3::timestamptz IS NULL OR updated_at<$3) ORDER BY updated_at DESC LIMIT $4",
      [i.query || null, i.tag || null, i.cursor || null, i.limit + 1],
    );
    const rows = r.rows.slice(0, i.limit),
      items = await Promise.all(rows.map((x) => view(this.pool, work(x))));
    return {
      items,
      nextCursor: r.rows.length > i.limit ? work(rows.at(-1)).updatedAt : null,
    };
  }
  async detail(id: string, u?: string) {
    const r = await this.pool.query(
      "SELECT * FROM community_works WHERE id=$1 AND status='published' AND visibility<>'private'",
      [id],
    );
    return r.rows[0] ? view(this.pool, work(r.rows[0]), u) : null;
  }
  async author(id: string, u?: string) {
    const a = await this.pool.query("SELECT id,name FROM users WHERE id=$1", [
      id,
    ]);
    if (!a.rows[0])
      throw new DomainError("AUTHOR_NOT_FOUND", 404, "作者不存在");
    const r = await this.pool.query(
      "SELECT * FROM community_works WHERE owner_id=$1 AND status='published' AND visibility='public' ORDER BY updated_at DESC",
      [id],
    );
    const f = await this.pool.query(
      "SELECT count(*)::int n,COALESCE(bool_or(follower_id=$2),false) following FROM community_follows WHERE author_id=$1",
      [id, u || null],
    );
    return {
      author: a.rows[0],
      works: await Promise.all(r.rows.map((x) => view(this.pool, work(x), u))),
      followerCount: f.rows[0].n,
      following: f.rows[0].following,
    };
  }
  async like(u: string, id: string, value: boolean) {
    const p = await this.pool.query(
      "SELECT 1 FROM community_works WHERE id=$1 AND status='published'",
      [id],
    );
    if (!p.rows[0]) throw missing();
    if (value)
      await this.pool.query(
        "INSERT INTO community_likes(work_id,user_id,created_at) VALUES($1,$2,now()) ON CONFLICT DO NOTHING",
        [id, u],
      );
    else
      await this.pool.query(
        "DELETE FROM community_likes WHERE work_id=$1 AND user_id=$2",
        [id, u],
      );
    const n = await this.pool.query(
      "SELECT count(*)::int n FROM community_likes WHERE work_id=$1",
      [id],
    );
    return { liked: value, likeCount: n.rows[0].n };
  }
  async follow(u: string, a: string, value: boolean) {
    if (u === a)
      throw new DomainError("COMMUNITY_SELF_FOLLOW", 422, "不能关注自己");
    if (value)
      await this.pool.query(
        "INSERT INTO community_follows(follower_id,author_id,created_at) VALUES($1,$2,now()) ON CONFLICT DO NOTHING",
        [u, a],
      );
    else
      await this.pool.query(
        "DELETE FROM community_follows WHERE follower_id=$1 AND author_id=$2",
        [u, a],
      );
    const n = await this.pool.query(
      "SELECT count(*)::int n FROM community_follows WHERE author_id=$1",
      [a],
    );
    return { following: value, followerCount: n.rows[0].n };
  }
  async report(
    u: string,
    id: string,
    code: string,
    detail: string,
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO community_reports(id,work_id,reporter_id,reason_code,detail,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6) ON CONFLICT DO NOTHING",
        [randomUUID(), id, u, code, detail, now],
      );
      await c.query(
        "INSERT INTO community_audit_log(actor_id,actor_kind,action,resource_type,resource_id,reason,request_id,created_at) VALUES($1,'user','report.created','community_work',$2,$3,$4,$5)",
        [u, id, code, randomUUID(), now],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async moderate(
    id: string,
    d: "approve" | "reject" | "take_down" | "restore",
    reason: string,
    requestId: string,
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT * FROM community_works WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!q.rows[0]) throw missing();
      const replay = await c.query(
        "SELECT 1 FROM community_audit_log WHERE actor_kind='maintenance' AND action=$1 AND resource_type='community_work' AND resource_id=$2 AND request_id=$3",
        [`work.${d}`, id, requestId],
      );
      if (replay.rows[0]) {
        await c.query("COMMIT");
        return work(q.rows[0]);
      }
      const allowed: any = {
        approve: ["pending", "published"],
        reject: ["pending", "rejected"],
        take_down: ["published", "taken_down"],
        restore: ["taken_down", "published"],
      };
      if (!allowed[d].includes(q.rows[0].status)) throw state();
      const status: any = {
        approve: "published",
        reject: "rejected",
        take_down: "taken_down",
        restore: "published",
      };
      if (d === "approve" && q.rows[0].status === "pending") {
        const v = await c.query(
          "SELECT COALESCE(MAX(version),0)+1 n FROM community_work_versions WHERE work_id=$1",
          [id],
        );
        await c.query(
          "INSERT INTO community_work_versions(id,work_id,workspace_id,version,snapshot,reviewed_by,published_at) VALUES($1,$2,$3,$4,$5::jsonb,NULL,$6)",
          [
            randomUUID(),
            id,
            q.rows[0].workspace_id,
            v.rows[0].n,
            JSON.stringify(q.rows[0].draft_snapshot),
            now,
          ],
        );
      }
      await c.query(
        "UPDATE community_works SET status=$2,moderation_reason=$3,updated_at=$4 WHERE id=$1",
        [id, status[d], reason, now],
      );
      await c.query(
        "INSERT INTO community_audit_log(actor_kind,action,resource_type,resource_id,reason,request_id,created_at) VALUES('maintenance',$1,'community_work',$2,$3,$4,$5)",
        [`work.${d}`, id, reason, requestId, now],
      );
      await c.query("COMMIT");
      return {
        ...work(q.rows[0]),
        status: status[d],
        moderationReason: reason,
        updatedAt: now,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async audit(id: string) {
    const r = await this.pool.query(
      "SELECT * FROM community_audit_log WHERE resource_type='community_work' AND resource_id=$1 ORDER BY created_at",
      [id],
    );
    return r.rows;
  }
}
type Db = { query: (q: string, a?: unknown[]) => Promise<{ rows: any[] }> };
async function role(db: Db, u: string, w: string, min: "viewer" | "editor") {
  const r = await db.query(
    "SELECT role FROM workspace_members WHERE user_id=$1 AND workspace_id=$2",
    [u, w],
  );
  const n: any = { viewer: 0, editor: 1, admin: 2, owner: 3 };
  if (!r.rows[0] || n[r.rows[0].role] < n[min])
    throw new DomainError("FORBIDDEN", 403, "空间权限不足");
}
async function view(
  db: Db,
  x: CommunityWork,
  u?: string,
): Promise<CommunityView> {
  const [a, l, f, v] = await Promise.all([
    db.query("SELECT id,name FROM users WHERE id=$1", [x.ownerId]),
    db.query(
      "SELECT count(*)::int n,COALESCE(bool_or(user_id=$2),false) liked FROM community_likes WHERE work_id=$1",
      [x.id, u || null],
    ),
    db.query(
      "SELECT count(*)::int n FROM community_follows WHERE author_id=$1",
      [x.ownerId],
    ),
    db.query(
      "SELECT * FROM community_work_versions WHERE work_id=$1 ORDER BY version DESC LIMIT 1",
      [x.id],
    ),
  ]);
  return {
    ...x,
    author: a.rows[0],
    likeCount: l.rows[0].n,
    liked: u ? l.rows[0].liked : undefined,
    followerCount: f.rows[0].n,
    version: v.rows[0] ? version(v.rows[0]) : null,
  };
}
const iso = (x: any) => new Date(x).toISOString();
const work = (x: any): CommunityWork => ({
  id: x.id,
  workspaceId: x.workspace_id,
  ownerId: x.owner_id,
  sourceProjectId: x.source_project_id,
  title: x.title,
  description: x.description,
  coverAssetId: x.cover_asset_id,
  tags: x.tags,
  visibility: x.visibility,
  status: x.status,
  revision: x.revision,
  draftSnapshot: x.draft_snapshot,
  moderationReason: x.moderation_reason,
  createdAt: iso(x.created_at),
  updatedAt: iso(x.updated_at),
});
const version = (x: any): CommunityVersion => ({
  id: x.id,
  workId: x.work_id,
  workspaceId: x.workspace_id,
  version: x.version,
  snapshot: x.snapshot,
  reviewedBy: x.reviewed_by,
  publishedAt: iso(x.published_at),
});
const missing = () =>
  new DomainError("COMMUNITY_WORK_NOT_FOUND", 404, "作品不存在");
const conflict = () =>
  new DomainError("COMMUNITY_IDEMPOTENCY_CONFLICT", 409, "幂等键内容漂移");
const revision = () =>
  new DomainError("REVISION_CONFLICT", 409, "作品版本冲突");
const locked = () =>
  new DomainError("COMMUNITY_WORK_LOCKED", 409, "当前状态不可修改");
const state = () =>
  new DomainError("COMMUNITY_STATE_CONFLICT", 409, "作品状态不允许该操作");
