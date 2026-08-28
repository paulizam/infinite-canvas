import { beforeEach, describe, expect, it, vi } from "vitest";

const unregisterPluginNodes = vi.fn();
const registerNodeDefinitions = vi.fn();
const fetchOfficialPlugins = vi.fn();

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal("window", { location: { origin: "https://canvas.example" } });
vi.mock("@/lib/canvas/node-registry", () => ({ registerNodeDefinitions, unregisterPluginNodes }));
vi.mock("@/lib/canvas/plugin-registry", () => ({ fetchOfficialPlugins }));
vi.mock("@/lib/canvas/plugin-runtime", () => ({
    getPluginRuntime: () => ({ version: "0.16.0", injectCSS: vi.fn(() => vi.fn()) }),
}));

const { activatePlugin, enforceOfficialRevocations, setPluginEnabled } = await import("./plugin-loader");
const { usePluginStore } = await import("@/stores/canvas/use-plugin-store");

const installed = {
    id: "official-note",
    name: "Official Note",
    version: "1.0.0",
    url: "https://plugins.example/note.js",
    source: "export default {}",
    enabled: true,
    official: true,
    trustedOfficial: true,
    integrity: "sha256-test",
    permissions: ["canvas:read" as const],
    installedAt: new Date(0).toISOString(),
};

describe("plugin lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePluginStore.setState({ plugins: [{ ...installed }] });
    });

    it("disables a revoked official plugin before cached startup activation", async () => {
        fetchOfficialPlugins.mockResolvedValue([{ id: installed.id, revoked: true, revokeReason: "compromised release" }]);
        await enforceOfficialRevocations();
        expect(usePluginStore.getState().plugins[0]).toMatchObject({ enabled: false, lastError: "compromised release" });
        expect(unregisterPluginNodes).toHaveBeenCalledWith(installed.id);
    });

    it("does not persist enabled state when stored plugin validation fails", async () => {
        const legacy = { ...installed, id: "legacy", enabled: false, official: false, trustedOfficial: false, sandboxed: false };
        usePluginStore.setState({ plugins: [legacy] });
        await expect(setPluginEnabled(legacy, true)).rejects.toThrow("Blocked legacy remote plugin");
        expect(usePluginStore.getState().plugins[0]?.enabled).toBe(false);
    });

    it("rolls back registered nodes when plugin setup throws", () => {
        const plugin = {
            id: "broken",
            name: "Broken",
            version: "1",
            nodes: [{ type: "broken", render: () => null }],
            setup: () => {
                throw new Error("setup failed");
            },
        } as never;
        expect(() => activatePlugin(plugin)).toThrow("setup failed");
        expect(registerNodeDefinitions).toHaveBeenCalled();
        expect(unregisterPluginNodes).toHaveBeenCalledWith("broken");
    });
});
