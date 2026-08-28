import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type { AdminMfaRepository } from "./admin-mfa-repository.js";
export class PostgresAdminMfaRepository implements AdminMfaRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async credential(userId: string) {
    const r = await this.pool.query(
        "SELECT * FROM admin_mfa_credentials WHERE user_id=$1",
        [userId],
      ),
      x = r.rows[0];
    return x
      ? {
          ciphertext: x.secret_ciphertext,
          iv: x.secret_iv,
          tag: x.secret_tag,
          enabled: x.enabled,
          lastCounter: Number(x.last_counter),
        }
      : null;
  }
  async sessionStatus(userId: string, hash: string) {
    const r = await this.pool.query(
      "SELECT COALESCE(m.enabled,false) enabled,s.mfa_verified_at FROM sessions s LEFT JOIN admin_mfa_credentials m ON m.user_id=s.user_id WHERE s.user_id=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now()",
      [userId, hash],
    );
    if (!r.rows[0])
      throw new DomainError("UNAUTHENTICATED", 401, "登录状态已失效");
    return {
      enabled: r.rows[0].enabled,
      verifiedAt: r.rows[0].mfa_verified_at
        ? new Date(r.rows[0].mfa_verified_at).toISOString()
        : null,
    };
  }
  async saveEnrollment(
    userId: string,
    secret: Parameters<AdminMfaRepository["saveEnrollment"]>[1],
    now: string,
  ) {
    await this.pool.query(
      "INSERT INTO admin_mfa_credentials(user_id,secret_ciphertext,secret_iv,secret_tag,enabled,last_counter,created_at,updated_at) VALUES($1,$2,$3,$4,false,-1,$5,$5) ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,enabled=false,last_counter=-1,verified_at=NULL,updated_at=EXCLUDED.updated_at",
      [userId, secret.ciphertext, secret.iv, secret.tag, now],
    );
  }
  confirm(input: Parameters<AdminMfaRepository["confirm"]>[0]) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE admin_mfa_credentials SET enabled=true,last_counter=$2,verified_at=$3,updated_at=$3 WHERE user_id=$1 AND NOT enabled AND last_counter<$2 RETURNING user_id",
        [input.userId, input.counter, input.now],
      );
      if (!r.rows[0]) throw invalid();
      await c.query("DELETE FROM admin_mfa_recovery_codes WHERE user_id=$1", [
        input.userId,
      ]);
      for (const hash of input.recoveryHashes)
        await c.query(
          "INSERT INTO admin_mfa_recovery_codes(id,user_id,code_hash,created_at) VALUES($1,$2,$3,$4)",
          [randomUUID(), input.userId, hash, input.now],
        );
      await assure(c, input.userId, input.sessionHash, input.now);
    });
  }
  verifyCounter(userId: string, hash: string, counter: number, now: string) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE admin_mfa_credentials SET last_counter=$2,updated_at=$3 WHERE user_id=$1 AND enabled AND last_counter<$2 RETURNING user_id",
        [userId, counter, now],
      );
      if (!r.rows[0]) throw invalid();
      await assure(c, userId, hash, now);
    });
  }
  consumeRecovery(
    userId: string,
    sessionHash: string,
    hash: string,
    now: string,
  ) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE admin_mfa_recovery_codes SET used_at=$3 WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id",
        [userId, hash, now],
      );
      if (!r.rows[0]) return false;
      await assure(c, userId, sessionHash, now);
      return true;
    });
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const x = await fn(c);
      await c.query("COMMIT");
      return x;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
async function assure(c: PoolClient, user: string, hash: string, now: string) {
  const r = await c.query(
    "UPDATE sessions SET mfa_verified_at=$3 WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>$3 RETURNING token_hash",
    [user, hash, now],
  );
  if (!r.rows[0])
    throw new DomainError("UNAUTHENTICATED", 401, "登录状态已失效");
}
const invalid = () =>
  new DomainError("MFA_CODE_INVALID", 401, "MFA 验证码无效或已使用");
