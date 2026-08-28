import { describe, expect, it } from "vitest";
import { authorizePermissionChange, permissionDiff, resolvePluginManifest, satisfiesMinAppVersion } from "./plugin-manifest";

const manifest = { id: "safe-note", name: "Safe Note", version: "1.2.3", entry: "./plugin.js", integrity: `sha256-${"A".repeat(43)}=`, permissions: ["canvas:read", "network:https://api.example/"] as const };

describe("plugin manifest [PLG-003]", () => {
    it("resolves a constrained HTTPS entry", () => expect(resolvePluginManifest(manifest, "https://plugins.example/safe/manifest.json").entry).toBe("https://plugins.example/safe/plugin.js"));
    it.each(["http://plugins.example/manifest.json", "https://user:pass@plugins.example/manifest.json"])("rejects unsafe manifest URL %s", (url) => expect(() => resolvePluginManifest(manifest, url)).toThrow(/HTTPS/));
    it("rejects broad or insecure network permission", () => expect(() => resolvePluginManifest({ ...manifest, permissions: ["network:http://api.example"] }, "https://plugins.example/manifest.json")).toThrow());
    it("validates app compatibility and detached signature declarations", () => {
        expect(resolvePluginManifest({ ...manifest, minAppVersion: "0.16.0", signature: `ed25519-${"A".repeat(86)}==` }, "https://plugins.example/manifest.json")).toMatchObject({ minAppVersion: "0.16.0" });
        expect(() => resolvePluginManifest({ ...manifest, minAppVersion: "latest" }, "https://plugins.example/manifest.json")).toThrow(/minAppVersion/);
        expect(() => resolvePluginManifest({ ...manifest, signature: "signed" }, "https://plugins.example/manifest.json")).toThrow(/signature/);
    });
    it("calculates newly requested permissions", () => expect(permissionDiff(["canvas:read"], ["canvas:read", "canvas:write"])).toEqual(["canvas:write"]));
    it("enforces minimum app version", () => {
        expect(satisfiesMinAppVersion("0.16.0", "0.15.1")).toBe(true);
        expect(satisfiesMinAppVersion("0.16.0", "1.0.0")).toBe(false);
    });
    it("requires the caller to confirm newly added permissions [PLG-006]", async () => {
        const decisions: string[][] = [];
        const result = await authorizePermissionChange(["canvas:read"], ["canvas:read", "canvas:write"], async (added) => {
            decisions.push(added);
            return false;
        });
        expect(result).toEqual({ added: ["canvas:write"], approved: false });
        expect(decisions).toEqual([["canvas:write"]]);
    });
});
