import type { EncryptedSecret } from "./secret-cipher.js";

export type AdminActor = {
  type: "maintenance" | "user" | "system";
  id: string;
  requestId: string;
};
export type AdminSetting = {
  namespace: string;
  key: string;
  value: unknown | null;
  secretConfigured: boolean;
  revision: number;
  updatedBy: string;
  updatedAt: string;
};
export interface AdminRepository {
  isAdmin(userId: string): Promise<boolean>;
  recordAudit(
    actor: AdminActor,
    action: string,
    resourceType: string,
    resourceId: string,
    details?: unknown,
  ): Promise<void>;
  dashboard(): Promise<Record<string, unknown>>;
  users(
    query: string | undefined,
    limit: number,
    cursor?: string,
  ): Promise<unknown>;
  updateUser(
    id: string,
    patch: { status?: "active" | "suspended"; platformRole?: "user" | "admin" },
    actor: AdminActor,
  ): Promise<unknown>;
  revokeSessions(id: string, actor: AdminActor): Promise<{ revoked: number }>;
  jobs(
    filters: Record<string, string | undefined>,
    limit: number,
  ): Promise<unknown>;
  transitionJob(
    id: string,
    action: "requeue" | "cancel" | "review",
    actor: AdminActor,
  ): Promise<unknown>;
  storage(): Promise<Record<string, unknown>>;
  audit(
    filters: Record<string, string | undefined>,
    limit: number,
  ): Promise<unknown[]>;
  settings(): Promise<AdminSetting[]>;
  saveSetting(
    input: {
      namespace: string;
      key: string;
      value?: unknown;
      secret?: EncryptedSecret;
      expectedRevision?: number;
    },
    actor: AdminActor,
  ): Promise<AdminSetting>;
  content(
    input: {
      id: string;
      kind: "announcement" | "prompt";
      title: string;
      content: string;
      status: "draft" | "published" | "archived";
      startsAt?: string | null;
      endsAt?: string | null;
      expectedRevision?: number;
    },
    actor: AdminActor,
  ): Promise<unknown>;
  listContent(kind?: "announcement" | "prompt"): Promise<unknown[]>;
}
