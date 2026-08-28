import { describe, expect, it } from "vitest";
import { permissionDiff, resolvePluginManifest, satisfiesMinAppVersion } from "./plugin-manifest";

const manifest = { id: "safe-note", name: "Safe Note", version: "1.2.3", entry: "./plugin.js", integrity: `sha256-${"A".repeat(43)}=`, permissions: ["canvas:read", "network:https://api.example/"] as const };

describe("plugin manifest", () => {
    it("resolves a constrained HTTPS entry", () => expect(resolvePluginManifest(manifest, "https://plugins.example/safe/manifest.json").entry).toBe("https://plugins.example/safe/plugin.js"));
    it.each(["http://plugins.example/manifest.json", "https://user:pass@plugins.example/manifest.json"])("rejects unsafe manifest URL %s", (url) => expect(() => resolvePluginManifest(manifest, url)).toThrow(/HTTPS/));
    it("rejects broad or insecure network permission", () => expect(() => resolvePluginManifest({ ...manifest, permissions: ["network:http://api.example"] }, "https://plugins.example/manifest.json")).toThrow());
    it("calculates newly requested permissions", () => expect(permissionDiff(["canvas:read"], ["canvas:read", "canvas:write"])).toEqual(["canvas:write"]));
    it("enforces minimum app version", () => {
        expect(satisfiesMinAppVersion("0.16.0", "0.15.1")).toBe(true);
        expect(satisfiesMinAppVersion("0.16.0", "1.0.0")).toBe(false);
    });
});
