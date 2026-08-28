import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AdminMfaRepository,
  MfaCredential,
} from "./admin-mfa-repository.js";
import { AdminMfaService, _totpForTest } from "./admin-mfa-service.js";
import { SecretCipher } from "./secret-cipher.js";
class MemoryMfa implements AdminMfaRepository {
  value: MfaCredential | null = null;
  verifiedAt: string | null = null;
  recovery = new Set<string>();
  async credential() {
    return this.value;
  }
  async sessionStatus() {
    return {
      enabled: this.value?.enabled || false,
      verifiedAt: this.verifiedAt,
    };
  }
  async saveEnrollment(
    _u: string,
    secret: Parameters<AdminMfaRepository["saveEnrollment"]>[1],
  ) {
    this.value = { ...secret, enabled: false, lastCounter: -1 };
    this.verifiedAt = null;
  }
  async confirm(x: Parameters<AdminMfaRepository["confirm"]>[0]) {
    if (
      !this.value ||
      this.value.enabled ||
      x.counter <= this.value.lastCounter
    )
      throw new Error("invalid");
    this.value.enabled = true;
    this.value.lastCounter = x.counter;
    this.verifiedAt = x.now;
    this.recovery = new Set(x.recoveryHashes);
  }
  async verifyCounter(_u: string, _s: string, counter: number, now: string) {
    if (!this.value || counter <= this.value.lastCounter)
      throw new Error("invalid");
    this.value.lastCounter = counter;
    this.verifiedAt = now;
  }
  async consumeRecovery(_u: string, _s: string, hash: string, now: string) {
    if (!this.recovery.delete(hash)) return false;
    this.verifiedAt = now;
    return true;
  }
}
describe("AdminMfaService", () => {
  afterEach(() => vi.useRealTimers());
  it("enrolls, prevents TOTP replay and consumes recovery codes once", async () => {
    vi.useFakeTimers();
    const clock = Date.parse("2026-08-28T08:00:00.000Z");
    vi.setSystemTime(clock);
    const repo = new MemoryMfa(),
      cipher = new SecretCipher(Buffer.alloc(32, 9).toString("base64")),
      service = new AdminMfaService(repo, cipher, "p".repeat(32)),
      user = crypto.randomUUID(),
      token = "t".repeat(43);
    await expect(service.authorize(user, token)).rejects.toMatchObject({
      code: "MFA_SETUP_REQUIRED",
    });
    const enrollment = await service.begin(user, "admin@example.test", token);
    expect(enrollment.otpauthUri).toContain("algorithm=SHA256");
    expect(repo.value?.ciphertext.toString()).not.toContain(enrollment.secret);
    const code = _totpForTest(enrollment.secret, clock),
      confirmed = await service.confirm(user, token, code);
    expect(confirmed.recoveryCodes).toHaveLength(10);
    await expect(service.authorize(user, token)).resolves.toBeUndefined();
    await expect(service.verify(user, token, { code })).rejects.toMatchObject({
      code: "MFA_CODE_INVALID",
    });
    vi.setSystemTime(clock + 30000);
    await expect(
      service.verify(user, token, {
        code: _totpForTest(enrollment.secret, clock + 30000),
      }),
    ).resolves.toMatchObject({ verified: true, recoveryUsed: false });
    const recovery = confirmed.recoveryCodes[0];
    await expect(
      service.verify(user, token, { recoveryCode: recovery }),
    ).resolves.toMatchObject({ recoveryUsed: true });
    await expect(
      service.verify(user, token, { recoveryCode: recovery }),
    ).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
  });
});
