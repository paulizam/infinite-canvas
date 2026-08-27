import pg from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  CommunityCollection,
  CommunityComment,
  CommunitySocialRepository,
} from "./community-social-repository.js";
export class PostgresCommunitySocialRepository implements CommunitySocialRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async comments(w: string, cursor: string | undefined, limit: number) {
    const r = await this.pool.query(
      "SELECT c.*,u.name author_name FROM community_comments c JOIN users u ON u.id=c.author_id JOIN community_works w ON w.id=c.work_id WHERE c.work_id=$1 AND c.status='visible' AND w.status='published' AND ($2::timestamptz IS NULL OR c.created_at>$2) ORDER BY c.created_at,c.id LIMIT $3",
      [w, cursor || null, limit + 1],
    );
    return {
      items: r.rows.slice(0, limit).map(comment),
      nextCursor:
        r.rows.length > limit ? iso(r.rows[limit - 1].created_at) : null,
    };
  }
  async comment(
    u: string,
    i: {
      id: string;
      workId: string;
      parentId: string | null;
      content: string;
      mutationId: string;
      now: string;
    },
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const old = await c.query(
        "SELECT c.*,u.name author_name FROM community_comments c JOIN users u ON u.id=c.author_id WHERE c.author_id=$1 AND c.mutation_id=$2",
        [u, i.mutationId],
      );
      if (old.rows[0]) {
        if (
          old.rows[0].work_id !== i.workId ||
          old.rows[0].content !== i.content
        )
          throw conflict();
        await c.query("COMMIT");
        return { comment: comment(old.rows[0]), replayed: true };
      }
      const w = await c.query(
        "SELECT 1 FROM community_works WHERE id=$1 AND status='published'",
        [i.workId],
      );
      if (!w.rows[0]) throw missing();
      if (i.parentId) {
        const p = await c.query(
          "SELECT 1 FROM community_comments WHERE id=$1 AND work_id=$2",
          [i.parentId, i.workId],
        );
        if (!p.rows[0])
          throw new DomainError(
            "COMMUNITY_PARENT_COMMENT_INVALID",
            422,
            "父评论不存在",
          );
      }
      await c.query(
        "INSERT INTO community_comments(id,work_id,author_id,parent_id,content,status,mutation_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'visible',$6,$7,$7)",
        [i.id, i.workId, u, i.parentId, i.content, i.mutationId, i.now],
      );
      const name = await c.query("SELECT name FROM users WHERE id=$1", [u]);
      await c.query("COMMIT");
      return {
        comment: {
          id: i.id,
          workId: i.workId,
          authorId: u,
          authorName: name.rows[0].name,
          parentId: i.parentId,
          content: i.content,
          status: "visible" as const,
          createdAt: i.now,
          updatedAt: i.now,
        },
        replayed: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async reportComment(
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
        "INSERT INTO community_comment_reports(id,comment_id,reporter_id,reason_code,detail,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6) ON CONFLICT DO NOTHING",
        [randomUUID(), id, u, code, detail, now],
      );
      await c.query(
        "INSERT INTO community_audit_log(actor_id,actor_kind,action,resource_type,resource_id,reason,request_id,created_at) VALUES($1,'user','comment.reported','community_comment',$2,$3,$4,$5)",
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
  async moderateComment(
    id: string,
    a: "hide" | "restore",
    reason: string,
    requestId: string,
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT c.*,u.name author_name FROM community_comments c JOIN users u ON u.id=c.author_id WHERE c.id=$1 FOR UPDATE OF c",
        [id],
      );
      if (!q.rows[0]) throw commentMissing();
      const action = `comment.${a}`,
        replay = await c.query(
          "SELECT 1 FROM community_audit_log WHERE actor_kind='maintenance' AND action=$1 AND resource_type='community_comment' AND resource_id=$2 AND request_id=$3",
          [action, id, requestId],
        );
      if (replay.rows[0]) {
        await c.query("COMMIT");
        return comment(q.rows[0]);
      }
      const status: CommunityComment["status"] =
        a === "hide" ? "hidden" : "visible";
      await c.query(
        "UPDATE community_comments SET status=$2,updated_at=$3 WHERE id=$1",
        [id, status, now],
      );
      await c.query(
        "INSERT INTO community_audit_log(actor_kind,action,resource_type,resource_id,reason,request_id,created_at) VALUES('maintenance',$1,'community_comment',$2,$3,$4,$5)",
        [action, id, reason, requestId, now],
      );
      await c.query("COMMIT");
      return { ...comment(q.rows[0]), status, updatedAt: now };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async bookmark(u: string, w: string, v: boolean) {
    const p = await this.pool.query(
      "SELECT 1 FROM community_works WHERE id=$1 AND status='published'",
      [w],
    );
    if (!p.rows[0]) throw missing();
    v
      ? await this.pool.query(
          "INSERT INTO community_bookmarks(work_id,user_id,created_at) VALUES($1,$2,now()) ON CONFLICT DO NOTHING",
          [w, u],
        )
      : await this.pool.query(
          "DELETE FROM community_bookmarks WHERE work_id=$1 AND user_id=$2",
          [w, u],
        );
    const n = await this.pool.query(
      "SELECT count(*)::int n FROM community_bookmarks WHERE work_id=$1",
      [w],
    );
    return { bookmarked: v, bookmarkCount: n.rows[0].n };
  }
  async bookmarks(u: string) {
    const r = await this.pool.query(
      "SELECT work_id FROM community_bookmarks WHERE user_id=$1 ORDER BY created_at DESC",
      [u],
    );
    return r.rows.map((x) => x.work_id);
  }
  async createCollection(u: string, i: Omit<CommunityCollection, "items">) {
    await this.pool.query(
      "INSERT INTO community_collections(id,owner_id,title,description,visibility,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,0,$6,$6)",
      [i.id, u, i.title, i.description, i.visibility, i.createdAt],
    );
    return { ...i, ownerId: u, items: [] };
  }
  async mutateCollection(
    u: string,
    id: string,
    e: number,
    key: string,
    hash: string,
    p: any,
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "SELECT * FROM community_collections WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, u],
      );
      if (!q.rows[0]) throw collectionMissing();
      const old = await c.query(
        "SELECT request_hash FROM community_collection_mutations WHERE collection_id=$1 AND mutation_id=$2",
        [id, key],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash) throw conflict();
        await c.query("COMMIT");
        return { collection: await collection(this.pool, id), replayed: true };
      }
      if (q.rows[0].revision !== e) throw revision();
      if (p.item) {
        if (p.item.value) {
          const w = await c.query(
            "SELECT 1 FROM community_works WHERE id=$1 AND status='published'",
            [p.item.workId],
          );
          if (!w.rows[0]) throw missing();
          await c.query(
            "INSERT INTO community_collection_items(collection_id,work_id,sort_order,added_at) VALUES($1,$2,$3,$4) ON CONFLICT(collection_id,work_id) DO UPDATE SET sort_order=EXCLUDED.sort_order",
            [id, p.item.workId, p.item.sortOrder, now],
          );
        } else
          await c.query(
            "DELETE FROM community_collection_items WHERE collection_id=$1 AND work_id=$2",
            [id, p.item.workId],
          );
      }
      await c.query(
        "UPDATE community_collections SET title=COALESCE($2,title),description=COALESCE($3,description),visibility=COALESCE($4,visibility),revision=revision+1,updated_at=$5 WHERE id=$1",
        [id, p.title ?? null, p.description ?? null, p.visibility ?? null, now],
      );
      await c.query(
        "INSERT INTO community_collection_mutations(collection_id,mutation_id,request_hash,resulting_revision,created_at) VALUES($1,$2,$3,$4,$5)",
        [id, key, hash, e + 1, now],
      );
      await c.query("COMMIT");
      return { collection: await collection(this.pool, id), replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async collection(id: string, u?: string) {
    const x = await collection(this.pool, id);
    return x && (x.visibility !== "private" || x.ownerId === u) ? x : null;
  }
  async collectionsByAuthor(a: string, u?: string) {
    const r = await this.pool.query(
      "SELECT id FROM community_collections WHERE owner_id=$1 AND (visibility<>'private' OR owner_id=$2) ORDER BY updated_at DESC",
      [a, u || null],
    );
    return Promise.all(
      r.rows.map((x) => collection(this.pool, x.id)),
    ) as Promise<CommunityCollection[]>;
  }
}
type Db = { query: (q: string, a?: unknown[]) => Promise<{ rows: any[] }> };
async function collection(db: Db, id: string) {
  const [q, i] = await Promise.all([
    db.query("SELECT * FROM community_collections WHERE id=$1", [id]),
    db.query(
      "SELECT work_id,sort_order FROM community_collection_items WHERE collection_id=$1 ORDER BY sort_order,added_at",
      [id],
    ),
  ]);
  if (!q.rows[0]) throw collectionMissing();
  const x = q.rows[0];
  return {
    id: x.id,
    ownerId: x.owner_id,
    title: x.title,
    description: x.description,
    visibility: x.visibility,
    revision: x.revision,
    createdAt: iso(x.created_at),
    updatedAt: iso(x.updated_at),
    items: i.rows.map((y) => ({ workId: y.work_id, sortOrder: y.sort_order })),
  } as CommunityCollection;
}
const iso = (x: any) => new Date(x).toISOString();
const comment = (x: any): CommunityComment => ({
  id: x.id,
  workId: x.work_id,
  authorId: x.author_id,
  authorName: x.author_name,
  parentId: x.parent_id,
  content: x.content,
  status: x.status,
  createdAt: iso(x.created_at),
  updatedAt: iso(x.updated_at),
});
const missing = () =>
  new DomainError("COMMUNITY_WORK_NOT_FOUND", 404, "作品不存在");
const commentMissing = () =>
  new DomainError("COMMUNITY_COMMENT_NOT_FOUND", 404, "评论不存在");
const collectionMissing = () =>
  new DomainError("COMMUNITY_COLLECTION_NOT_FOUND", 404, "合集不存在");
const conflict = () =>
  new DomainError("COMMUNITY_IDEMPOTENCY_CONFLICT", 409, "幂等键内容漂移");
const revision = () =>
  new DomainError("REVISION_CONFLICT", 409, "合集版本冲突");
