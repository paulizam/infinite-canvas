import type { PluginPermission } from "@infinite-canvas/contracts";

export type SandboxNodeDescriptor = { type: string; title: string; description?: string; defaultSize: { width: number; height: number }; defaultMetadata?: Record<string, unknown>; minimapColor?: string; showInCreateMenu?: boolean; hasSourceHandle?: boolean };
export type SandboxPluginDescriptor = { id: string; name: string; version: string; description?: string; nodes: SandboxNodeDescriptor[] };

const SANDBOX_TIMEOUT_MS = 5_000;
const PLUGIN_SOURCE_BYTES_LIMIT = 2 * 1024 * 1024;

const WORKER_SOURCE = `
self.onmessage = async (event) => {
  const { source, version, networkOrigins } = event.data;
  const nativeFetch = self.fetch.bind(self);
  self.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, self.location.href);
    if (!networkOrigins.includes(url.origin)) throw new Error("Plugin network permission denied");
    return nativeFetch(input, { ...init, credentials: "omit" });
  };
  self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const mod = await import(url); const value = typeof mod.default === "function" ? await mod.default({ version }) : mod.default;
    const nodes = Array.isArray(value?.nodes) ? value.nodes.map((node) => ({ type: node.type, title: node.title, description: node.description, defaultSize: node.defaultSize, defaultMetadata: node.defaultMetadata, minimapColor: node.minimapColor, showInCreateMenu: node.showInCreateMenu, hasSourceHandle: node.hasSourceHandle })) : [];
    self.postMessage({ type: "result", value: { id: value?.id, name: value?.name, version: value?.version, description: value?.description, nodes } });
  } catch (error) { self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) }); }
  finally { URL.revokeObjectURL(url); }
};`;

export function evaluateSandboxPlugin(source: string, appVersion: string, permissions: PluginPermission[]): Promise<SandboxPluginDescriptor> {
    if (new TextEncoder().encode(source).byteLength > PLUGIN_SOURCE_BYTES_LIMIT) return Promise.reject(new Error("插件源码超过 2MiB 限额"));
    const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(workerUrl, { type: "module", name: "canvas-plugin-sandbox" });
    const networkOrigins = networkOriginsFromPermissions(permissions);
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => { finish(); reject(new Error("插件沙箱执行超时")); }, SANDBOX_TIMEOUT_MS);
        const finish = () => { window.clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(workerUrl); };
        worker.onerror = (event) => { finish(); reject(new Error(event.message || "插件沙箱启动失败")); };
        worker.onmessage = (event: MessageEvent<{ type: string; value?: unknown; error?: string }>) => {
            finish();
            if (event.data.type === "error") return reject(new Error(event.data.error || "插件沙箱执行失败"));
            try { resolve(assertSandboxDescriptor(event.data.value)); } catch (error) { reject(error); }
        };
        worker.postMessage({ source, version: appVersion, networkOrigins });
    });
}

export function networkOriginsFromPermissions(permissions: PluginPermission[]): string[] {
    const allowed = new Set(["canvas:read", "canvas:write", "assets:read", "assets:write", "ai:generate"]);
    return permissions.flatMap((permission) => {
        if (allowed.has(permission)) return [];
        if (!permission.startsWith("network:")) throw new Error(`未知插件权限: ${permission}`);
        const url = new URL(permission.slice(8));
        if (url.protocol !== "https:" || url.origin !== permission.slice(8)) throw new Error(`无效的插件网络权限: ${permission}`);
        return [url.origin];
    });
}

function assertSandboxDescriptor(value: unknown): SandboxPluginDescriptor {
    const plugin = value as Partial<SandboxPluginDescriptor> | null;
    if (!plugin?.id || !plugin.name || !plugin.version || !Array.isArray(plugin.nodes) || !plugin.nodes.length) throw new Error("无效的沙箱插件描述");
    for (const node of plugin.nodes) if (!node?.type || !node.title || !Number.isFinite(node.defaultSize?.width) || !Number.isFinite(node.defaultSize?.height)) throw new Error("无效的沙箱节点描述");
    return plugin as SandboxPluginDescriptor;
}
