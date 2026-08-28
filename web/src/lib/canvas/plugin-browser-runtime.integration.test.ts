// @vitest-environment node

import { createHash } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer as createViteServer, type ViteDevServer } from "vite";

const enabled = process.env.PLUGIN_BROWSER_TEST === "1";
const edgeCandidates = [
    process.env.PLUGIN_BROWSER_EXECUTABLE,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter((candidate): candidate is string => Boolean(candidate));

type Release = { version: string; source: string; integrity: string; revoked?: boolean; revokeReason?: string };

function pluginSource(version: string) {
    return `export default async ({ version: appVersion }) => {
  let networkDenied = false;
  try { await fetch("https://blocked.invalid/runtime-check"); }
  catch (error) { networkDenied = error instanceof Error && error.message === "Plugin network permission denied"; }
  return {
    id: "runtime-registry-plugin",
    name: "Runtime Registry Plugin",
    version: "${version}",
    description: "browser=" + appVersion,
    nodes: [{
      type: "runtime-registry-node",
      title: networkDenied ? "Sandbox network denied ${version}" : "UNSAFE NETWORK ACCESS",
      defaultSize: { width: 320, height: 180 },
      defaultMetadata: { release: "${version}" },
      showInCreateMenu: true
    }]
  };
};`;
}

function release(version: string, extra: Partial<Release> = {}): Release {
    const source = pluginSource(version);
    return { version, source, integrity: `sha256-${createHash("sha256").update(source).digest("base64")}`, ...extra };
}

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("Runtime server did not expose a TCP port"));
            resolve(address.port);
        });
    });
}

function close(server: Server | undefined): Promise<void> {
    if (!server?.listening) return Promise.resolve();
    return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe.runIf(enabled)("[PLG-005] published registry in a real browser sandbox", () => {
    let registryServer: Server;
    let vite: ViteDevServer;
    let browser: Browser;
    let registryOrigin: string;
    let appOrigin: string;
    let current = release("1.0.0");

    beforeAll(async () => {
        const executablePath = edgeCandidates.find(existsSync);
        if (!executablePath) throw new Error("Set PLUGIN_BROWSER_EXECUTABLE to a Chromium-compatible browser");

        registryServer = createHttpServer((request, response) => {
            response.setHeader("Access-Control-Allow-Origin", appOrigin || "*");
            response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            response.setHeader("Access-Control-Allow-Headers", "Accept");
            response.setHeader("Cache-Control", "no-store");
            if (request.method === "OPTIONS") {
                response.writeHead(204).end();
                return;
            }
            if (request.url === "/official-plugins.json") {
                response.setHeader("Content-Type", "application/json");
                response.end(
                    JSON.stringify({
                        version: 2,
                        plugins: [
                            {
                                id: "runtime-registry-plugin",
                                name: "Runtime Registry Plugin",
                                version: current.version,
                                entry: "/plugin.js",
                                integrity: current.integrity,
                                permissions: [],
                                revoked: current.revoked,
                                revokeReason: current.revokeReason,
                            },
                        ],
                    }),
                );
                return;
            }
            if (request.url?.startsWith("/plugin.js")) {
                response.setHeader("Content-Type", "text/javascript; charset=utf-8");
                response.end(current.source);
                return;
            }
            response.writeHead(404).end("not found");
        });
        registryOrigin = `http://127.0.0.1:${await listen(registryServer)}`;
        process.env.VITE_PLUGIN_REGISTRY_URL = `${registryOrigin}/official-plugins.json`;

        vite = await createViteServer({
            configFile: fileURLToPath(new URL("../../../vite.config.ts", import.meta.url)),
            server: { host: "127.0.0.1", port: 0, strictPort: false },
            logLevel: "error",
        });
        vite.middlewares.use("/__plugin-runtime.html", (_request, response) => {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end("<!doctype html><meta charset=utf-8><title>Plugin runtime verification</title>");
        });
        await vite.listen();
        const address = vite.httpServer?.address();
        if (!address || typeof address === "string") throw new Error("Vite runtime server did not expose a TCP port");
        appOrigin = `http://127.0.0.1:${address.port}`;

        browser = await chromium.launch({ executablePath, headless: true });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        await vite?.close();
        await close(registryServer);
        delete process.env.VITE_PLUGIN_REGISTRY_URL;
    });

    test("installs, pins, upgrades, revokes, disables and uninstalls the sandboxed plugin", async () => {
        const page = await browser.newPage();
        await page.goto(`${appOrigin}/__plugin-runtime.html`);
        await page.addScriptTag({
            type: "module",
            content: `window.__pluginRuntimeModules = await Promise.all([
              "/src/lib/canvas/plugin-registry.ts",
              "/src/lib/canvas/plugin-loader.ts",
              "/src/stores/canvas/use-plugin-store.ts",
              "/src/lib/canvas/node-registry.ts"
            ].map((url) => import(url)));`,
        });
        await page.waitForFunction(() => Boolean((window as any).__pluginRuntimeModules));

        const installed = await page.evaluate(async ({ registryUrl }) => {
            const [registry, loader, store, nodes] = (window as any).__pluginRuntimeModules;
            const [entry] = await registry.fetchOfficialPlugins(registryUrl);
            await loader.installPluginFromUrl(entry.url, { official: true, id: entry.id, integrity: entry.integrity, permissions: entry.permissions });
            const record = store.usePluginStore.getState().plugins.find((item: { id: string }) => item.id === entry.id);
            const node = nodes.getNodeDefinition("runtime-registry-node");
            return { record, title: node?.title, owner: nodes.getNodePluginId("runtime-registry-node") };
        }, { registryUrl: `${registryOrigin}/official-plugins.json` });
        expect(installed.record).toMatchObject({ id: "runtime-registry-plugin", version: "1.0.0", enabled: true, official: true, sandboxed: true, local: false });
        expect(installed.title).toBe("Sandbox network denied 1.0.0");
        expect(installed.owner).toBe("runtime-registry-plugin");

        const toggled = await page.evaluate(async () => {
            const [, loader, store, nodes] = (window as any).__pluginRuntimeModules;
            const record = store.usePluginStore.getState().plugins[0]!;
            await loader.setPluginEnabled(record, false);
            const absentWhenDisabled = !nodes.isRegisteredNodeType("runtime-registry-node");
            await loader.setPluginEnabled(store.usePluginStore.getState().plugins[0]!, true);
            return { absentWhenDisabled, enabled: store.usePluginStore.getState().plugins[0]?.enabled, restored: nodes.isRegisteredNodeType("runtime-registry-node") };
        });
        expect(toggled).toEqual({ absentWhenDisabled: true, enabled: true, restored: true });

        current = release("2.0.0");
        const upgraded = await page.evaluate(async ({ registryUrl }) => {
            const [registry, loader, store, nodes] = (window as any).__pluginRuntimeModules;
            const [entry] = await registry.fetchOfficialPlugins(registryUrl);
            const before = store.usePluginStore.getState().plugins[0]!;
            const upgradeAvailable = registry.hasUpgrade(before.version, entry.version);
            await loader.installPluginFromUrl(entry.url, { official: true, id: entry.id, integrity: entry.integrity, permissions: entry.permissions, bustCache: true });
            const after = store.usePluginStore.getState().plugins[0]!;
            return { upgradeAvailable, version: after.version, source: after.source, integrity: after.integrity, title: nodes.getNodeDefinition("runtime-registry-node")?.title };
        }, { registryUrl: `${registryOrigin}/official-plugins.json` });
        expect(upgraded).toMatchObject({ upgradeAvailable: true, version: "2.0.0", source: current.source, integrity: current.integrity, title: "Sandbox network denied 2.0.0" });

        current = release("3.0.0");
        const pinned = await page.evaluate(async ({ registryUrl }) => {
            const [registry, , store] = (window as any).__pluginRuntimeModules;
            const [remote] = await registry.fetchOfficialPlugins(registryUrl);
            return { installed: store.usePluginStore.getState().plugins[0]?.version, remote: remote.version };
        }, { registryUrl: `${registryOrigin}/official-plugins.json` });
        expect(pinned).toEqual({ installed: "2.0.0", remote: "3.0.0" });

        current = release("3.0.0", { revoked: true, revokeReason: "runtime revocation fixture" });
        const revoked = await page.evaluate(async () => {
            const [, loader, store, nodes] = (window as any).__pluginRuntimeModules;
            await loader.enforceOfficialRevocations();
            const record = store.usePluginStore.getState().plugins[0];
            return { enabled: record?.enabled, error: record?.lastError, registered: nodes.isRegisteredNodeType("runtime-registry-node") };
        });
        expect(revoked).toEqual({ enabled: false, error: "runtime revocation fixture", registered: false });

        const uninstalled = await page.evaluate(async () => {
            const [, loader, store, nodes] = (window as any).__pluginRuntimeModules;
            loader.uninstallPlugin("runtime-registry-plugin");
            return { count: store.usePluginStore.getState().plugins.length, registered: nodes.isRegisteredNodeType("runtime-registry-node") };
        });
        expect(uninstalled).toEqual({ count: 0, registered: false });
        await page.close();
    }, 45_000);
});
