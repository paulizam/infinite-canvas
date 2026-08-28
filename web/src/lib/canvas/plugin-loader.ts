import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import i18n from "@/i18n";
import { assertTrustedPluginUrl, isTrustedPluginUrl } from "@/lib/canvas/plugin-trust";
import { verifyPluginIntegrity } from "@/lib/canvas/plugin-integrity";
import { evaluateSandboxPlugin } from "@/lib/canvas/plugin-sandbox";
import { createSandboxCanvasPlugin } from "@/lib/canvas/sandbox-canvas-plugin";
import type { PluginPermission } from "@infinite-canvas/contracts";
import { fetchPluginManifest, satisfiesMinAppVersion, type ResolvedPluginManifest } from "@/lib/canvas/plugin-manifest";
import { fetchOfficialPlugins } from "@/lib/canvas/plugin-registry";

const cleanups = new Map<string, () => void>();

// A remote plugin may export CanvasPlugin directly or a factory that receives runtime and returns CanvasPlugin.
// The factory uses runtime.React so the bundle does not need its own React copy.
async function evaluateTrustedPluginSource(source: string): Promise<CanvasPlugin> {
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
    if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
}

export function activatePlugin(plugin: CanvasPlugin) {
    registerNodeDefinitions(plugin.nodes, plugin.id);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    try {
        // Inject declared styles when enabled and remove them when disabled or uninstalled.
        if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
        const cleanup = plugin.setup?.(runtime);
        if (typeof cleanup === "function") disposers.push(cleanup);
        if (disposers.length) cleanups.set(plugin.id, () => disposers.forEach((dispose) => dispose()));
    } catch (error) {
        for (const dispose of disposers.reverse()) dispose();
        unregisterPluginNodes(plugin.id);
        throw error;
    }
}

export function deactivatePlugin(pluginId: string) {
    cleanups.get(pluginId)?.();
    cleanups.delete(pluginId);
    unregisterPluginNodes(pluginId);
}

async function fetchPluginSource(url: string) {
    const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 2 * 1024 * 1024) throw new Error("插件源码超过 2MiB 限额");
    const source = await response.text();
    if (new TextEncoder().encode(source).byteLength > 2 * 1024 * 1024) throw new Error("插件源码超过 2MiB 限额");
    return source;
}

// Add a cache-busting parameter so watch builds load the latest output.
function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

// Install or replace a plugin from a URL and enable it immediately.
// bustCache bypasses HTTP/CDN caches during upgrades while persisting a clean URL without the timestamp query.
type PluginInstallOptions = { official?: boolean; bustCache?: boolean; id?: string; integrity?: string; permissions?: PluginPermission[]; manifestUrl?: string };

export async function installPluginFromUrl(url: string, opts?: PluginInstallOptions) {
    const local = isTrustedPluginUrl(url, window.location.origin);
    if (!local && (!opts?.integrity || !opts.permissions)) throw new Error("远程插件必须提供完整性与权限清单");
    const source = await fetchPluginSource(opts?.bustCache ? withCacheBust(url) : url);
    const trustedOfficial = !local && Boolean(opts?.official);
    if (trustedOfficial) await verifyPluginIntegrity(source, opts!.integrity!);
    const plugin = local || trustedOfficial ? await evaluateTrustedPluginSource(source) : await evaluateRemotePlugin(source, opts!);
    if (opts?.id && plugin.id !== opts.id) throw new Error("插件标识与清单不匹配");
    deactivatePlugin(plugin.id); // Replace the previous version.
    usePluginStore
        .getState()
        .upsert({
            id: plugin.id,
            name: plugin.name || plugin.id,
            version: plugin.version || "0.0.0",
            description: plugin.description,
            url,
            manifestUrl: opts?.manifestUrl,
            source,
            enabled: true,
            official: opts?.official,
            local,
            trustedOfficial,
            sandboxed: !local && !trustedOfficial,
            integrity: opts?.integrity,
            permissions: opts?.permissions,
            lastCheckedAt: new Date().toISOString(),
        });
    activatePlugin(plugin);
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
    if (record.manifestUrl) {
        const manifest = await fetchPluginManifest(record.manifestUrl);
        if (manifest.id !== record.id) throw new Error("插件标识与清单不匹配");
        return installPluginManifest(manifest, record.official);
    }
    // Upgrades must fetch the latest output and therefore always bypass caches.
    return installPluginFromUrl(record.url, { official: record.official, bustCache: true, id: record.id, integrity: record.integrity, permissions: record.permissions });
}

export async function installPluginFromManifest(manifestUrl: string, official = false) {
    return installPluginManifest(await fetchPluginManifest(manifestUrl), official);
}

export async function installPluginManifest(manifest: ResolvedPluginManifest, official = false) {
    if (!satisfiesMinAppVersion(getPluginRuntime().version, manifest.minAppVersion)) throw new Error(`插件要求应用版本 ${manifest.minAppVersion} 或更高`);
    return installPluginFromUrl(manifest.entry, { official, id: manifest.id, integrity: manifest.integrity, permissions: manifest.permissions, manifestUrl: manifest.manifestUrl });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    if (!enabled) {
        usePluginStore.getState().setEnabled(record.id, false);
        deactivatePlugin(record.id);
        return;
    }
    // Reload local plugins from their URL when enabled because the cached source may be stale.
    const source = record.local ? await fetchPluginSource(withCacheBust(record.url)) : record.source;
    const plugin = await evaluateStoredPlugin(record, source);
    deactivatePlugin(record.id);
    activatePlugin(plugin);
    usePluginStore.getState().setEnabled(record.id, true);
}

export function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
}

let loaded = false;

// Load installed and enabled plugins at application startup.
export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    await usePluginStore.persist.rehydrate();
    await loadLocalPlugins(); // Discover disabled local plugins first, then activate all enabled records.
    await enforceOfficialRevocations();
    const records = usePluginStore.getState().plugins.filter((record) => record.enabled);
    await Promise.all(
        records.map(async (record) => {
            try {
                if (!record.local && !record.sandboxed && !record.trustedOfficial) {
                    usePluginStore.getState().setEnabled(record.id, false);
                    throw new Error("Blocked legacy remote plugin");
                }
                // Local plugins use the latest output; other plugins use their cached source.
                const source = record.local ? await fetchPluginSource(withCacheBust(record.url)) : record.source;
                activatePlugin(await evaluateStoredPlugin(record, source));
            } catch (error) {
                usePluginStore.getState().setDiagnostic(record.id, error instanceof Error ? error.message : String(error));
                console.error(`[plugin] Failed to load: ${record.id}`, error);
            }
        }),
    );
    await loadDevPlugins();
}

export async function enforceOfficialRevocations() {
    const enabledOfficial = usePluginStore.getState().plugins.filter((record) => record.enabled && record.official);
    if (!enabledOfficial.length) return;
    try {
        const revoked = new Map((await fetchOfficialPlugins()).filter((entry) => entry.revoked).map((entry) => [entry.id, entry.revokeReason || "插件版本已被撤销"]));
        for (const record of enabledOfficial) {
            const reason = revoked.get(record.id);
            if (!reason) continue;
            deactivatePlugin(record.id);
            usePluginStore.getState().setEnabled(record.id, false);
            usePluginStore.getState().setDiagnostic(record.id, reason);
        }
    } catch (error) {
        console.warn("[plugin] Revocation check unavailable; using integrity-verified cache", error);
    }
}

// Discover local plugins from web/public/plugins, add them disabled, and expose them in the manager without a URL.
// Refresh metadata and source for existing records while preserving the enabled flag so persisted versions stay current.
async function loadLocalPlugins() {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json");
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        return; // Skip when no local manifest exists, such as production builds without plugins.
    }
    if (!Array.isArray(urls) || !urls.length) return;
    const store = usePluginStore.getState();
    await Promise.all(
        urls.map(async (url: string) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                assertTrustedPluginUrl(url, window.location.origin);
                const plugin = await evaluateTrustedPluginSource(source);
                const existing = store.plugins.find((item) => item.id === plugin.id);
                store.upsert({
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    version: plugin.version || "0.0.0",
                    description: plugin.description,
                    url,
                    source,
                    enabled: existing?.enabled ?? false, // Preserve the user setting; new discoveries default to disabled.
                    local: true,
                });
            } catch (error) {
                console.error(`[plugin] Failed to discover local plugin: ${url}`, error);
            }
        }),
    );
}

// During local development, refetch VITE_DEV_PLUGINS URLs without caching or persistence on every startup.
// Together with watch builds, refreshing the page loads code changes without reinstalling the plugin.
async function loadDevPlugins() {
    const raw = import.meta.env.VITE_DEV_PLUGINS;
    if (!raw) return;
    const urls = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    if (!import.meta.env.DEV) return;
    await Promise.all(
        urls.map(async (url) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                const plugin = await evaluateTrustedPluginSource(source);
                deactivatePlugin(plugin.id);
                activatePlugin(plugin);
                console.info(`[plugin] Dev plugin loaded: ${plugin.id} (${url})`);
            } catch (error) {
                console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
            }
        }),
    );
}

async function evaluateRemotePlugin(source: string, options: PluginInstallOptions): Promise<CanvasPlugin> {
    await verifyPluginIntegrity(source, options.integrity!);
    const descriptor = await evaluateSandboxPlugin(source, getPluginRuntime().version, options.permissions!);
    return createSandboxCanvasPlugin(descriptor, options.permissions!);
}

async function evaluateStoredPlugin(record: InstalledPlugin, source: string): Promise<CanvasPlugin> {
    if (record.local) {
        assertTrustedPluginUrl(record.url, window.location.origin);
        return evaluateTrustedPluginSource(source);
    }
    if (record.trustedOfficial && record.integrity) {
        await verifyPluginIntegrity(source, record.integrity);
        return evaluateTrustedPluginSource(source);
    }
    if (!record.sandboxed || !record.integrity || !record.permissions) throw new Error("Blocked legacy remote plugin");
    return evaluateRemotePlugin(source, { id: record.id, integrity: record.integrity, permissions: record.permissions });
}
