import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DomainError } from "./domain.js";
import { SecretCipher } from "./secret-cipher.js";
import type { AdminMfaRepository } from "./admin-mfa-repository.js";
export class AdminMfaService {
  constructor(
    private repository: AdminMfaRepository,
    private cipher: SecretCipher,
    private recoveryPepper: string,
    private issuer = "Infinite Canvas",
    private assuranceMs = 12 * 60 * 60 * 1000,
  ) {
    if (Buffer.byteLength(recoveryPepper) < 32)
      throw new Error("MFA_RECOVERY_PEPPER must contain at least 32 bytes");
  }
  async status(userId: string, token: string) {
    const x = await this.repository.sessionStatus(userId, hashToken(token));
    return {
      enabled: x.enabled,
      sessionVerified:
        !!x.verifiedAt &&
        Date.now() - Date.parse(x.verifiedAt) <= this.assuranceMs,
      verifiedAt: x.verifiedAt,
    };
  }
  async authorize(userId: string, token: string) {
    const x = await this.status(userId, token);
    if (!x.enabled)
      throw new DomainError("MFA_SETUP_REQUIRED", 403, "管理员必须先配置 MFA");
    if (!x.sessionVerified)
      throw new DomainError("MFA_REQUIRED", 403, "需要完成 MFA 验证");
  }
  async begin(userId: string, email: string, token: string) {
    const state = await this.status(userId, token);
    if (state.enabled && !state.sessionVerified)
      throw new DomainError(
        "MFA_REQUIRED",
        403,
        "重新配置 MFA 前必须验证当前 Session",
      );
    const secret = base32(randomBytes(20)),
      now = new Date().toISOString();
    await this.repository.saveEnrollment(
      userId,
      this.cipher.encrypt(secret, `admin-mfa:${userId}`),
      now,
    );
    const label = encodeURIComponent(`${this.issuer}:${email}`),
      issuer = encodeURIComponent(this.issuer);
    return {
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA256&digits=6&period=30`,
    };
  }
  async confirm(userId: string, token: string, code: string) {
    const counter = await this.validCounter(userId, code, false),
      codes = Array.from({ length: 10 }, () => recoveryCode()),
      now = new Date().toISOString();
    await this.repository.confirm({
      userId,
      sessionHash: hashToken(token),
      counter,
      recoveryHashes: codes.map((x) => this.recoveryHash(x)),
      now,
    });
    return { recoveryCodes: codes };
  }
  async verify(
    userId: string,
    token: string,
    input: { code?: string; recoveryCode?: string },
  ) {
    const now = new Date().toISOString();
    if (input.recoveryCode) {
      const ok = await this.repository.consumeRecovery(
        userId,
        hashToken(token),
        this.recoveryHash(input.recoveryCode),
        now,
      );
      if (!ok) throw invalid();
      return { verified: true, recoveryUsed: true };
    }
    if (!input.code) throw invalid();
    const counter = await this.validCounter(userId, input.code, true);
    await this.repository.verifyCounter(userId, hashToken(token), counter, now);
    return { verified: true, recoveryUsed: false };
  }
  private async validCounter(userId: string, code: string, enabled: boolean) {
    if (!/^\d{6}$/.test(code)) throw invalid();
    const credential = await this.repository.credential(userId);
    if (!credential || credential.enabled !== enabled) throw invalid();
    const secret = this.cipher.decrypt(credential, `admin-mfa:${userId}`),
      current = Math.floor(Date.now() / 30000);
    for (const counter of [current, current - 1, current + 1])
      if (
        counter > credential.lastCounter &&
        safeEqual(totp(secret, counter), code)
      )
        return counter;
    throw invalid();
  }
  private recoveryHash(code: string) {
    return createHmac("sha256", this.recoveryPepper)
      .update(code.trim().toUpperCase())
      .digest("hex");
  }
}
const hashToken = (x: string) => createHash("sha256").update(x).digest("hex");
const invalid = () =>
  new DomainError("MFA_CODE_INVALID", 401, "MFA 验证码无效或已使用");
function totp(secret: string, counter: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha256", decodeBase32(secret)).update(b).digest(),
    o = h[h.length - 1] & 15,
    n = (h.readUInt32BE(o) & 0x7fffffff) % 1000000;
  return String(n).padStart(6, "0");
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decodeBase32(input: string) {
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const c of input.replace(/=+$/, "")) {
    const n = alphabet.indexOf(c.toUpperCase());
    if (n < 0) throw invalid();
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
const recoveryCode = () => {
  const x = randomBytes(10).toString("hex").toUpperCase();
  return `${x.slice(0, 5)}-${x.slice(5, 10)}-${x.slice(10, 15)}-${x.slice(15)}`;
};
export const _totpForTest = (secret: string, timeMs: number) =>
  totp(secret, Math.floor(timeMs / 30000));
