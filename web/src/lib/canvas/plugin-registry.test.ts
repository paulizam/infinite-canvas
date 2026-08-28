import { describe, expect, it, vi } from "vitest";
import type { PluginPermission } from "@infinite-canvas/contracts";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { parseOfficialPluginManifest } = await import("./plugin-registry");

describe("official plugin manifest", () => {
    const plugin = { id: "note", name: "Note", version: "1.0.0", entry: "note.js", integrity: "sha256-abc", permissions: ["canvas:read"] as PluginPermission[] };
    it("accepts v2 SRI entries and compatibility constraints", () => expect(parseOfficialPluginManifest({ version: 2, plugins: [{ ...plugin, minAppVersion: "0.16.0" }] }, "https://cdn.example/manifest.json")[0]).toMatchObject({ url: "https://cdn.example/note.js", minAppVersion: "0.16.0" }));
    it("preserves registry revocation metadata", () => expect(parseOfficialPluginManifest({ version: 2, plugins: [{ ...plugin, revoked: true, revokeReason: "compromised" }] }, "https://cdn.example/manifest.json")[0]).toMatchObject({ revoked: true, revokeReason: "compromised" }));
    it("rejects legacy or unsigned entries", () => {
        expect(parseOfficialPluginManifest({ version: 1, plugins: [plugin] }, "https://cdn.example/manifest.json")).toEqual([]);
        expect(parseOfficialPluginManifest({ version: 2, plugins: [{ ...plugin, integrity: undefined }] }, "https://cdn.example/manifest.json")).toEqual([]);
    });
});
