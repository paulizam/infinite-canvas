import { cloudApiBaseUrl } from "@/services/cloud-platform";

export type AdminDashboard = Record<string, Record<string, number | string | null>> & { generatedAt: string };
export type AdminUser = { id: string; email: string; name: string; status: "active" | "suspended"; platformRole: "user" | "admin"; balanceUnits: number; activeSessions: number; workspaces: number; createdAt: string };
export type AdminJob = { id: string; ownerId: string; capability: string; logicalModelId: string; attempt: number; status: string; phase: string; provider: string | null; errorCode: string | null; errorMessage: string | null; updatedAt: string };
export type AdminAudit = { id: string; actorId: string; action: string; resourceType: string; resourceId: string; requestId: string; createdAt: string };
export type AdminSetting = { namespace: string; key: string; value: unknown | null; secretConfigured: boolean; revision: number; updatedAt: string };
export type AdminContent = { id: string; kind: "announcement" | "prompt"; title: string; content: string; status: "draft" | "published" | "archived"; revision: number; updatedAt: string };

class AdminPlatform {
    dashboard = () => this.get<AdminDashboard>("/dashboard");
    users = (q = "") => this.get<{ items: AdminUser[]; nextCursor: string | null }>(`/users?q=${encodeURIComponent(q)}`);
    updateUser = (id: string, body: Partial<Pick<AdminUser, "status" | "platformRole">>) => this.send<AdminUser>(`/users/${id}`, "PATCH", body);
    revokeSessions = (id: string) => this.send<{ revoked: number }>(`/users/${id}/revoke-sessions`, "POST", {});
    jobs = () => this.get<AdminJob[]>("/jobs");
    jobAction = (id: string, action: "requeue" | "cancel" | "review") => this.send<AdminJob>(`/jobs/${id}/actions`, "POST", { action });
    storage = () => this.get<Record<string, unknown>>("/storage");
    audit = () => this.get<AdminAudit[]>("/audit");
    settings = () => this.get<AdminSetting[]>("/settings");
    saveSetting = (namespace: string, key: string, body: { value?: unknown; secret?: string; expectedRevision?: number }) => this.send<AdminSetting>(`/settings/${namespace}/${key}`, "PUT", body);
    content = () => this.get<AdminContent[]>("/content");
    saveContent = (body: Omit<AdminContent, "id" | "revision" | "updatedAt">) => this.send<AdminContent>("/content", "POST", body);
    auditCsvUrl = () => `${cloudApiBaseUrl}/api/v1/admin/audit?format=csv&limit=1000`;
    private get<T>(path: string) {
        return this.request<T>(path);
    }
    private send<T>(path: string, method: string, body: unknown) {
        return this.request<T>(path, { method, body: JSON.stringify(body) });
    }
    private async request<T>(path: string, init: RequestInit = {}) {
        const response = await fetch(`${cloudApiBaseUrl}/api/v1/admin${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...init.headers } });
        const payload = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string }; requestId?: string } | null;
        if (!response.ok) throw new Error(`${payload?.error?.message || response.statusText}${payload?.requestId ? ` · ${payload.requestId}` : ""}`);
        if (!payload || !("data" in payload)) throw new Error("Admin API 响应无效");
        return payload.data as T;
    }
}
export const adminPlatform = new AdminPlatform();
