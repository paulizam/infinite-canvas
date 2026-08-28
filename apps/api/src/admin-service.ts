import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type { AdminActor, AdminRepository } from "./admin-repository.js";
import { SecretCipher } from "./secret-cipher.js";

const PUBLIC_SETTINGS = new Map<string, (value: unknown) => boolean>([
  [
    "site.brandName",
    (x) => typeof x === "string" && x.trim().length > 0 && x.length <= 80,
  ],
  ["site.registrationEnabled", (x) => typeof x === "boolean"],
  ["mail.from", (x) => typeof x === "string" && x.length <= 320],
  ["network.proxyUrl", validOptionalHttpsUrl],
  [
    "generation.maxConcurrency",
    (x) => Number.isSafeInteger(x) && Number(x) >= 1 && Number(x) <= 1000,
  ],
  ["features.flags", validFlags],
]);
const SECRET_SETTINGS = new Set(["mail.smtpPassword", "network.proxyPassword"]);

export class AdminService {
  constructor(
    private repository: AdminRepository,
    private cipher: SecretCipher,
  ) {}
  async requireAdmin(userId: string) {
    if (!(await this.repository.isAdmin(userId)))
      throw new DomainError("ADMIN_FORBIDDEN", 403, "需要平台管理员权限");
  }
  record(
    actor: AdminActor,
    action: string,
    resourceType: string,
    resourceId: string,
    details?: unknown,
  ) {
    return this.repository.recordAudit(
      actor,
      action,
      resourceType,
      resourceId,
      details,
    );
  }
  dashboard() {
    return this.repository.dashboard();
  }
  users(q?: string, limit = 50, cursor?: string) {
    return this.repository.users(q?.trim(), bounded(limit, 100), cursor);
  }
  updateUser(
    id: string,
    patch: { status?: "active" | "suspended"; platformRole?: "user" | "admin" },
    actor: AdminActor,
  ) {
    if (!patch.status && !patch.platformRole)
      throw new DomainError("ADMIN_PATCH_EMPTY", 422, "用户变更为空");
    return this.repository.updateUser(id, patch, actor);
  }
  revokeSessions(id: string, actor: AdminActor) {
    return this.repository.revokeSessions(id, actor);
  }
  jobs(filters: Record<string, string | undefined>, limit = 50) {
    return this.repository.jobs(filters, bounded(limit, 100));
  }
  transitionJob(
    id: string,
    action: "requeue" | "cancel" | "review",
    actor: AdminActor,
  ) {
    return this.repository.transitionJob(id, action, actor);
  }
  storage() {
    return this.repository.storage();
  }
  audit(filters: Record<string, string | undefined>, limit = 100) {
    return this.repository.audit(filters, bounded(limit, 1000));
  }
  settings() {
    return this.repository.settings();
  }
  saveSetting(
    input: {
      namespace: string;
      key: string;
      value?: unknown;
      secret?: string;
      expectedRevision?: number;
    },
    actor: AdminActor,
  ) {
    const id = `${input.namespace}.${input.key}`;
    if (SECRET_SETTINGS.has(id)) {
      if (!input.secret?.trim())
        throw new DomainError("ADMIN_SECRET_REQUIRED", 422, "Secret 不能为空");
      return this.repository.saveSetting(
        {
          namespace: input.namespace,
          key: input.key,
          secret: this.cipher.encrypt(input.secret, `platform-setting:${id}`),
          expectedRevision: input.expectedRevision,
        },
        actor,
      );
    }
    const validate = PUBLIC_SETTINGS.get(id);
    if (!validate || !validate(input.value))
      throw new DomainError("ADMIN_SETTING_INVALID", 422, "配置项或配置值无效");
    return this.repository.saveSetting(
      {
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        expectedRevision: input.expectedRevision,
      },
      actor,
    );
  }
  content(
    input: Omit<Parameters<AdminRepository["content"]>[0], "id"> & {
      id?: string;
    },
    actor: AdminActor,
  ) {
    if (input.endsAt && input.startsAt && input.endsAt <= input.startsAt)
      throw new DomainError(
        "ADMIN_CONTENT_WINDOW_INVALID",
        422,
        "运营内容时间窗无效",
      );
    return this.repository.content(
      { ...input, id: input.id || randomUUID() },
      actor,
    );
  }
  listContent(kind?: "announcement" | "prompt") {
    return this.repository.listContent(kind);
  }
}
const bounded = (n: number, max: number) =>
  Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : 50;
function validOptionalHttpsUrl(x: unknown) {
  if (x === null || x === "") return true;
  if (typeof x !== "string") return false;
  try {
    const url = new URL(x);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function validFlags(x: unknown) {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x).length <= 100 &&
    Object.values(x).every((v) => typeof v === "boolean")
  );
}
