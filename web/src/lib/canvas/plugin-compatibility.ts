import type { InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import { satisfiesMinAppVersion } from "@/lib/canvas/plugin-manifest";

export type PluginCompatibilityIssue = {
    code: "APP_VERSION" | "LEGACY_REMOTE" | "INTEGRITY" | "PERMISSIONS" | "RUNTIME";
    severity: "error" | "warning";
    message: string;
};

export type PluginCompatibilityReport = {
    compatible: boolean;
    sandboxed: boolean;
    pinnedVersion: string;
    checkedAt: string;
    issues: PluginCompatibilityIssue[];
};

// Produce a stable, user-visible report without evaluating plugin code.
export function inspectPluginCompatibility(record: InstalledPlugin, appVersion: string, checkedAt = new Date().toISOString()): PluginCompatibilityReport {
    const issues: PluginCompatibilityIssue[] = [];
    if (!satisfiesMinAppVersion(appVersion, record.minAppVersion)) issues.push({ code: "APP_VERSION", severity: "error", message: `需要应用版本 ${record.minAppVersion} 或更高` });
    if (!record.local && !record.sandboxed && !record.trustedOfficial) issues.push({ code: "LEGACY_REMOTE", severity: "error", message: "旧版远程插件未运行在沙箱中" });
    if (!record.local && !record.integrity) issues.push({ code: "INTEGRITY", severity: "error", message: "远程插件缺少 integrity" });
    if (!record.local && !record.permissions) issues.push({ code: "PERMISSIONS", severity: "error", message: "远程插件缺少权限清单" });
    if (record.lastError) issues.push({ code: "RUNTIME", severity: "warning", message: record.lastError });
    return { compatible: !issues.some((issue) => issue.severity === "error"), sandboxed: Boolean(record.sandboxed), pinnedVersion: record.version, checkedAt, issues };
}
