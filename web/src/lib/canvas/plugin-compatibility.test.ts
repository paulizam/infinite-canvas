import { describe, expect, it } from "vitest";
import { inspectPluginCompatibility } from "./plugin-compatibility";

const installed = {
    id: "safe-note",
    name: "Safe Note",
    version: "1.2.3",
    minAppVersion: "0.15.0",
    url: "https://plugins.example/note.js",
    source: "export default {}",
    enabled: true,
    sandboxed: true,
    integrity: "sha256-test",
    permissions: ["canvas:read" as const],
    installedAt: new Date(0).toISOString(),
};

describe("plugin compatibility report [PLG-005] [PLG-007]", () => {
    it("reports a compatible pinned sandbox release", () => expect(inspectPluginCompatibility(installed, "0.16.0", "2026-01-01T00:00:00.000Z")).toMatchObject({ compatible: true, sandboxed: true, pinnedVersion: "1.2.3", issues: [] }));
    it("fails closed for incompatible legacy records", () => {
        const report = inspectPluginCompatibility({ ...installed, minAppVersion: "1.0.0", sandboxed: false, integrity: undefined, permissions: undefined }, "0.16.0");
        expect(report.compatible).toBe(false);
        expect(report.issues.map((issue) => issue.code)).toEqual(["APP_VERSION", "LEGACY_REMOTE", "INTEGRITY", "PERMISSIONS"]);
    });
    it("preserves isolated runtime diagnostics as a warning", () => expect(inspectPluginCompatibility({ ...installed, lastError: "render failed" }, "0.16.0").issues).toContainEqual({ code: "RUNTIME", severity: "warning", message: "render failed" }));
});
