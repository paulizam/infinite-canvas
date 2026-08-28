import { describe, expect, it, vi } from "vitest";
import type { AdminRepository, AdminSetting } from "./admin-repository.js";
import { AdminService } from "./admin-service.js";
import { SecretCipher } from "./secret-cipher.js";

const actor = { type: "maintenance" as const, id: "ops", requestId: "req-1" };
function repository() {
  const settings: AdminSetting[] = [];
  const repo: AdminRepository = {
    isAdmin: vi.fn(async () => true),
    recordAudit: vi.fn(async () => undefined),
    dashboard: vi.fn(async () => ({ users: { total: 1 } })),
    users: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateUser: vi.fn(async (id, patch) => ({ id, ...patch })),
    revokeSessions: vi.fn(async () => ({ revoked: 2 })),
    jobs: vi.fn(async () => []),
    transitionJob: vi.fn(async (id, action) => ({ id, action })),
    storage: vi.fn(async () => ({ assets: 0, bytes: 0 })),
    audit: vi.fn(async () => []),
    settings: vi.fn(async () => settings),
    saveSetting: vi.fn(async (input, who) => {
      const value = {
        namespace: input.namespace,
        key: input.key,
        value: input.secret ? null : input.value,
        secretConfigured: !!input.secret,
        revision: 1,
        updatedBy: who.id,
        updatedAt: new Date().toISOString(),
      };
      settings.push(value);
      return value;
    }),
    content: vi.fn(async (x) => x),
    listContent: vi.fn(async () => []),
    listPublishedPrompts: vi.fn(async () => []),
  };
  return repo;
}
describe("AdminService", () => {
  it("validates typed settings and never passes secret plaintext to persistence", async () => {
    const repo = repository(),
      service = new AdminService(
        repo,
        new SecretCipher(Buffer.alloc(32, 7).toString("base64")),
      );
    await expect(
      service.saveSetting(
        { namespace: "site", key: "registrationEnabled", value: true },
        actor,
      ),
    ).resolves.toMatchObject({ value: true, secretConfigured: false });
    const secret = await service.saveSetting(
      { namespace: "mail", key: "smtpPassword", secret: "do-not-return" },
      actor,
    );
    expect(secret).toMatchObject({ value: null, secretConfigured: true });
    const persisted = vi.mocked(repo.saveSetting).mock.calls[1][0];
    expect(persisted).not.toHaveProperty("value");
    expect(persisted.secret?.ciphertext.toString()).not.toContain(
      "do-not-return",
    );
    expect(() =>
      service.saveSetting(
        {
          namespace: "network",
          key: "proxyUrl",
          value: "http://127.0.0.1:8080",
        },
        actor,
      ),
    ).toThrow("配置项或配置值无效");
  });
  it("bounds list sizes and rejects empty user mutations", async () => {
    const repo = repository(),
      service = new AdminService(
        repo,
        new SecretCipher(Buffer.alloc(32, 8).toString("base64")),
      );
    await service.users(" a ", 10000);
    expect(repo.users).toHaveBeenCalledWith("a", 100, undefined);
    expect(() => service.updateUser(crypto.randomUUID(), {}, actor)).toThrow(
      "用户变更为空",
    );
  });
  it("[GEN-014] exposes explicit requeue, cancel, and needs-review actions", async () => {
    const repo = repository();
    const service = new AdminService(repo, new SecretCipher(Buffer.alloc(32, 6).toString("base64")));
    await service.transitionJob("job-1", "requeue", actor);
    await service.transitionJob("job-2", "cancel", actor);
    await service.transitionJob("job-3", "review", actor);
    expect(repo.transitionJob).toHaveBeenNthCalledWith(1, "job-1", "requeue", actor);
    expect(repo.transitionJob).toHaveBeenNthCalledWith(2, "job-2", "cancel", actor);
    expect(repo.transitionJob).toHaveBeenNthCalledWith(3, "job-3", "review", actor);
  });
  it("[AST-009] exposes only repository-filtered published prompt catalog entries", async () => {
    const repo = repository();
    const service = new AdminService(repo, new SecretCipher(Buffer.alloc(32, 9).toString("base64")));
    await service.publishedPrompts(" portrait ", " featured ", "2026-01-01T00:00:00.000Z");
    expect(repo.listPublishedPrompts).toHaveBeenCalledWith({
      category: "portrait",
      tag: "featured",
      now: "2026-01-01T00:00:00.000Z",
    });
  });
});
