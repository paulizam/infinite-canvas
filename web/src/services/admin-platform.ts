import { cloudApiBaseUrl } from "@/services/cloud-platform";
import type { LogicalModel, LogicalModelBinding, ModelChannel, ModelProtocol, UpstreamModel } from "@infinite-canvas/contracts";

export type AdminDashboard = Record<string, Record<string, number | string | null>> & { generatedAt: string };
export type AdminUser = { id: string; email: string; name: string; status: "active" | "suspended"; platformRole: "user" | "admin"; balanceUnits: number; activeSessions: number; workspaces: number; createdAt: string };
export type AdminJob = { id: string; ownerId: string; capability: string; logicalModelId: string; attempt: number; status: string; phase: string; provider: string | null; errorCode: string | null; errorMessage: string | null; updatedAt: string };
export type AdminAudit = { id: string; actorId: string; action: string; resourceType: string; resourceId: string; requestId: string; createdAt: string };
export type AdminSetting = { namespace: string; key: string; value: unknown | null; secretConfigured: boolean; revision: number; updatedAt: string };
export type AdminContent = { id: string; kind: "announcement" | "prompt"; title: string; content: string; status: "draft" | "published" | "archived"; revision: number; updatedAt: string };
export type AdminModelCatalog = { protocols: ModelProtocol[]; channels: ModelChannel[]; upstreamModels: UpstreamModel[]; logicalModels: LogicalModel[]; bindings: LogicalModelBinding[] };
export type AdminCommerce = { products: Array<Record<string, unknown>>; promotions: Array<Record<string, unknown>>; codes: Array<Record<string, unknown>>; referrals: Array<Record<string, unknown>> };

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
    models = () => this.get<AdminModelCatalog>("/models/catalog");
    saveProtocol = (id: string, body: Omit<ModelProtocol, "id">) => this.send<ModelProtocol>(`/models/protocols/${encodeURIComponent(id)}`, "PUT", body);
    saveChannel = (id: string, body: Omit<ModelChannel, "id" | "credentialConfigured"> & { apiKey?: string; clearCredential?: boolean }) => this.send<ModelChannel>(`/models/channels/${id}`, "PUT", body);
    discover = (id: string) => this.send<{ models: Array<{ id: string; displayName?: string }>; latencyMs: number }>(`/models/channels/${id}/discover`, "POST", {});
    testChannel = (id: string) => this.send<{ ok: boolean; modelCount: number; latencyMs: number }>(`/models/channels/${id}/test`, "POST", {});
    saveUpstream = (id: string, body: Omit<UpstreamModel, "id">) => this.send<UpstreamModel>(`/models/upstream/${id}`, "PUT", body);
    saveLogical = (id: string, body: Omit<LogicalModel, "id">) => this.send<LogicalModel>(`/models/logical/${encodeURIComponent(id)}`, "PUT", body);
    saveBinding = (id: string, body: Omit<LogicalModelBinding, "id">) => this.send<LogicalModelBinding>(`/models/bindings/${id}`, "PUT", body);
    commerce = () => this.get<AdminCommerce>("/commerce");
    saveProduct = (body: Record<string, unknown>) => this.send<Record<string, unknown>>("/commerce/products", "PUT", body);
    savePromotion = (body: Record<string, unknown>) => this.send<Record<string, unknown>>("/commerce/promotions", "PUT", body);
    createCode = (body: Record<string, unknown>) => this.send<Record<string, unknown>>("/commerce/codes", "POST", body);
    orders = () => this.get<Array<Record<string, unknown>>>("/commerce/orders");
    refunds = () => this.get<Array<Record<string, unknown>>>("/commerce/refunds");
    createRefund = (body: Record<string, unknown>) => this.send<Record<string, unknown>>("/commerce/refunds", "POST", body);
    reconcile = (body: Record<string, unknown>) => this.send<Record<string, unknown>>("/commerce/reconciliation", "POST", body);
    report = (from: string, to: string) => this.get<Record<string, number>>(`/commerce/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
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
