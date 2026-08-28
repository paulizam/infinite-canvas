import type { PluginManifest, PluginPermission } from "@infinite-canvas/contracts";

export type ResolvedPluginManifest = Omit<PluginManifest, "entry"> & {
    entry: string;
    manifestUrl: string;
};

const MANIFEST_BYTES_LIMIT = 64 * 1024;

export async function fetchPluginManifest(manifestUrl: string): Promise<ResolvedPluginManifest> {
    const url = assertHttpsUrl(manifestUrl, "插件清单");
    const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`插件清单下载失败 (HTTP ${response.status})`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MANIFEST_BYTES_LIMIT) throw new Error("插件清单超过 64KiB 限额");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MANIFEST_BYTES_LIMIT) throw new Error("插件清单超过 64KiB 限额");
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error("插件清单不是有效 JSON");
    }
    return resolvePluginManifest(value, url.toString());
}

export function resolvePluginManifest(value: unknown, manifestUrl: string): ResolvedPluginManifest {
    const manifest = value as Partial<PluginManifest> | null;
    if (!manifest || !isPluginId(manifest.id) || !manifest.name || !isSemver(manifest.version) || !manifest.entry || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(manifest.integrity || "") || !Array.isArray(manifest.permissions)) {
        throw new Error("插件清单字段无效");
    }
    assertPermissions(manifest.permissions);
    const entry = new URL(manifest.entry, assertHttpsUrl(manifestUrl, "插件清单"));
    assertHttpsUrl(entry.toString(), "插件入口");
    return { ...manifest, id: manifest.id, name: manifest.name, version: manifest.version, entry: entry.toString(), integrity: manifest.integrity, permissions: [...new Set(manifest.permissions)], manifestUrl } as ResolvedPluginManifest;
}

export function permissionDiff(current: PluginPermission[] = [], next: PluginPermission[] = []) {
    const previous = new Set(current);
    return next.filter((permission) => !previous.has(permission));
}

export function satisfiesMinAppVersion(appVersion: string, minimum?: string): boolean {
    if (!minimum) return true;
    const parts = (value: string) =>
        value
            .replace(/^v/, "")
            .split(".")
            .slice(0, 3)
            .map((item) => Number.parseInt(item, 10) || 0);
    const left = parts(appVersion);
    const right = parts(minimum);
    for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) return left[index]! > right[index]!;
    }
    return true;
}

function assertPermissions(permissions: PluginPermission[]) {
    for (const permission of permissions) {
        if (["canvas:read", "canvas:write", "assets:read", "assets:write", "ai:generate"].includes(permission)) continue;
        if (!permission.startsWith("network:")) throw new Error(`未知插件权限: ${permission}`);
        const target = assertHttpsUrl(permission.slice(8), "插件网络权限");
        if (target.toString() !== `${target.origin}/`) throw new Error(`插件网络权限必须只声明 origin: ${permission}`);
    }
}

function assertHttpsUrl(value: string, label: string): URL {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label}必须使用无凭据 HTTPS URL`);
    return url;
}

function isPluginId(value: unknown): value is string {
    return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isSemver(value: unknown): value is string {
    return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}
