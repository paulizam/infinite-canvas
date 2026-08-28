import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, Download, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { installPluginFromUrl, installPluginManifest, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, hasUpgrade, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { authorizePermissionChange, fetchPluginManifest } from "@/lib/canvas/plugin-manifest";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import { inspectPluginCompatibility } from "@/lib/canvas/plugin-compatibility";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialError, setOfficialError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    const localPlugins = useMemo(() => plugins.filter((item) => item.local), [plugins]);
    const thirdPartyPlugins = useMemo(() => plugins.filter((item) => !item.local && !item.official), [plugins]);

    const confirmPermissions = (name: string, permissions: string[]) =>
        new Promise<boolean>((resolve) => {
            Modal.confirm({
                title: t("canvas.plugins.permissionTitle", { defaultValue: `确认 ${name} 的权限` }),
                content: permissions.length ? <div className="space-y-1">{permissions.map((permission) => <code key={permission} className="block rounded bg-black/5 px-2 py-1 text-xs">{permission}</code>)}</div> : t("canvas.plugins.noNewPermissions", { defaultValue: "没有新增权限" }),
                okText: t("canvas.plugins.confirmInstall", { defaultValue: "确认安装" }),
                cancelText: t("canvas.editors.cancel"),
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
        }
    }, []);

    // Fetch the official registry when opening the panel, but only if it has not been loaded yet.
    useEffect(() => {
        if (open && official.length === 0 && !loadingOfficial && !officialError) void loadOfficial();
    }, [open, official.length, loadingOfficial, officialError, loadOfficial]);

    useEffect(() => {
        for (const entry of official) {
            const record = recordById.get(entry.id);
            if (entry.revoked && record?.enabled) void setPluginEnabled(record, false);
        }
    }, [official, recordById]);

    const handleInstallUrl = async () => {
        const target = url.trim();
        if (!target) return;
        setInstalling(true);
        try {
            const manifest = await fetchPluginManifest(target);
            if (!(await authorizePermissionChange([], manifest.permissions, (added) => confirmPermissions(manifest.name, added))).approved) return;
            const plugin = await installPluginManifest(manifest);
            message.success(t("canvas.plugins.installedPlugin", { name: plugin.name }));
            setUrl("");
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setInstalling(false);
        }
    };

    const handleInstallOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            if (entry.revoked) throw new Error(entry.revokeReason || "插件版本已被撤销");
            if (!(await authorizePermissionChange(recordById.get(entry.id)?.permissions, entry.permissions, (added) => confirmPermissions(entry.name, added))).approved) return;
            const plugin = await installPluginFromUrl(entry.url, { official: true, id: entry.id, integrity: entry.integrity, permissions: entry.permissions, minAppVersion: entry.minAppVersion });
            message.success(t("canvas.plugins.installed", { name: plugin.name }));
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            usePluginStore.getState().setDiagnostic(record.id);
            message.success(successText);
        } catch (error) {
            usePluginStore.getState().setDiagnostic(record.id, error instanceof Error ? error.message : String(error));
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    // Installed plugin actions: enable toggle plus update/uninstall for non-local plugins.
    // Highlight the update action when a newer remote version is available.
    const installedControls = (record: InstalledPlugin, upgradable = false, entry?: OfficialPluginEntry) => (
        <>
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
            {!record.local && (
                <>
                    <Button
                        type={upgradable ? "primary" : "text"}
                        size="small"
                        icon={<RefreshCw className="size-4" />}
                        loading={busyId === record.id}
                        title={t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
                        onClick={() => runOnPlugin(record, async () => {
                            if (entry) {
                                if (entry.revoked) throw new Error(entry.revokeReason || "插件版本已被撤销");
                                if (!(await authorizePermissionChange(record.permissions, entry.permissions, (added) => confirmPermissions(entry.name, added))).approved) return;
                                await installPluginFromUrl(entry.url, { official: true, id: entry.id, integrity: entry.integrity, permissions: entry.permissions, minAppVersion: entry.minAppVersion });
                            } else if (record.manifestUrl) {
                                const manifest = await fetchPluginManifest(record.manifestUrl);
                                if (!(await authorizePermissionChange(record.permissions, manifest.permissions, (added) => confirmPermissions(manifest.name, added))).approved) return;
                                await installPluginManifest(manifest);
                            } else await updatePlugin(record);
                        }, t("canvas.plugins.updated"))}
                    />
                    <Popconfirm title={t("canvas.plugins.uninstallTitle")} okText={t("canvas.plugins.uninstall")} cancelText={t("canvas.editors.cancel")} onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title={t("canvas.plugins.uninstall")} />
                    </Popconfirm>
                </>
            )}
        </>
    );

    // Add a green dot at the icon's top-right corner when an update is available.
    // A card-colored box shadow separates the dot visually from the icon.
    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <span className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "#22c55e", boxShadow: `0 0 0 2px ${theme.node.fill}` }} title={t("canvas.plugins.newVersion")} />
        </span>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // Shared plugin row: icon, title with name and version, description, and actions.
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const officialTab = (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.plugins.officialDescription")}
                </div>
                <Button type="text" size="small" icon={<RefreshCw className={`size-4 ${loadingOfficial ? "animate-spin" : ""}`} />} onClick={loadOfficial} disabled={loadingOfficial}>
                    {t("canvas.plugins.refresh")}
                </Button>
            </div>
            {officialError ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {t("canvas.plugins.loadFailed", { error: officialError })}
                </div>
            ) : loadingOfficial && official.length === 0 ? (
                emptyHint(t("canvas.plugins.loadingOfficial"))
            ) : official.length === 0 ? (
                emptyHint(t("canvas.plugins.noOfficial"))
            ) : (
                <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                    {official.map((entry) => {
                        const record = recordById.get(entry.id);
                        // Show the update dot and highlight the action when the remote version is newer.
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            // Show local and remote versions in the title so the update target is explicit.
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            entry.description,
                            record ? (
                                installedControls(record, upgradable, entry)
                            ) : (
                                <Button type="primary" size="small" danger={entry.revoked} disabled={entry.revoked} icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => handleInstallOfficial(entry)} title={entry.revokeReason}>
                                    {entry.revoked ? t("canvas.plugins.revoked", { defaultValue: "已撤销" }) : t("canvas.plugins.install")}
                                </Button>
                            ),
                        );
                    })}
                </div>
            )}
        </div>
    );

    const diagnostic = (record: InstalledPlugin) => {
        const report = inspectPluginCompatibility(record, getPluginRuntime().version);
        const summary = report.issues.map((issue) => issue.message).join(" · ");
        return [record.description || record.url, summary || `已固定 v${report.pinnedVersion}${report.sandboxed ? " · sandbox" : ""}`].filter(Boolean).join(" · ");
    };
    const localTab = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, diagnostic(record), installedControls(record)))}</div>;

    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input placeholder={t("canvas.plugins.manifestUrlPlaceholder", { defaultValue: "第三方插件 manifest.json HTTPS 地址" })} value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={handleInstallUrl} allowClear />
                <Button type="primary" loading={installing} onClick={handleInstallUrl} icon={<Puzzle className="size-4" />}>
                    {t("canvas.plugins.install")}
                </Button>
            </div>
            <div className="thin-scrollbar max-h-[42vh] space-y-2 overflow-auto">{thirdPartyPlugins.length === 0 ? emptyHint(t("canvas.plugins.noThirdParty")) : thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, diagnostic(record), installedControls(record)))}</div>
        </div>
    );

    const tabs = [
        { key: "official", label: t("canvas.plugins.official"), children: officialTab },
        ...(localPlugins.length > 0 ? [{ key: "local", label: t("canvas.plugins.local"), children: localTab }] : []),
        { key: "third", label: t("canvas.plugins.thirdParty"), children: thirdPartyTab },
    ];

    return (
        <Modal title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "#f59e0b55", background: "#f59e0b14", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>{t("canvas.plugins.warning")}</span>
                </div>
                <Tabs defaultActiveKey="official" items={tabs} />
            </div>
        </Modal>
    );
}
