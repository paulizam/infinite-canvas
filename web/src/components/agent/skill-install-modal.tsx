import { useState } from "react";
import { App, Checkbox, Input, Modal } from "antd";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { installCodexSkill, previewCodexSkillInstall, type AgentSkillInstallPreview } from "@/services/api/canvas-agent";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = { open: boolean; endpoint: string; token: string; onClose: () => void; onInstalled: () => Promise<unknown> | unknown };

export function SkillInstallModal({ open, endpoint, token, onClose, onInstalled }: Props) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [source, setSource] = useState("");
    const [preview, setPreview] = useState<AgentSkillInstallPreview | null>(null);
    const [confirmed, setConfirmed] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const permissions = preview ? [...new Set([...preview.permissions.declared, ...preview.permissions.inferred])] : [];
    const close = () => {
        if (busy) return;
        setSource(""); setPreview(null); setConfirmed([]); onClose();
    };
    const submit = async () => {
        if (!preview && !source.trim()) return message.warning(t("agent.skillManager.installSourceRequired"));
        setBusy(true);
        try {
            if (!preview) {
                const response = await previewCodexSkillInstall(endpoint, token, source.trim());
                if (!response.data) throw new Error(t("agent.skillManager.installPreviewMissing"));
                setPreview(response.data);
                return;
            }
            await installCodexSkill(endpoint, token, preview, confirmed);
            const name = preview.skill.name;
            setBusy(false); close(); await onInstalled();
            message.success(t("agent.skillManager.installed", { name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t(preview ? "agent.skillManager.installFailed" : "agent.skillManager.installPreviewFailed"));
        } finally { setBusy(false); }
    };
    return (
        <Modal title={t("agent.skillManager.installGithub")} open={open} width={720} centered destroyOnHidden confirmLoading={busy} okText={t(preview ? "agent.skillManager.installNow" : "agent.skillManager.previewInstall")} cancelText={t("common.cancel")} okButtonProps={{ disabled: Boolean(preview && permissions.some((item) => !confirmed.includes(item))) }} onCancel={close} onOk={() => void submit()}>
            <div className="space-y-4 pt-2">
                <div><div className="mb-1.5 text-xs font-medium">{t("agent.skillManager.installSource")}</div><Input value={source} disabled={busy || Boolean(preview)} onChange={(event) => setSource(event.target.value)} placeholder="https://github.com/owner/repo/tree/main/path/to/skill" /></div>
                {preview ? <>
                    <div className="rounded-md border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke }}><div className="font-medium">{preview.skill.name}</div><div style={{ color: theme.node.muted }}>{preview.skill.description}</div><div className="mt-2 break-all font-mono" style={{ color: theme.node.faint }}>{preview.source.owner}/{preview.source.repo} · {preview.source.ref} → {preview.source.commitSha}</div></div>
                    <div><div className="mb-1.5 text-xs font-medium">{t("agent.skillManager.installFiles", { count: preview.files.length })}</div><div className="thin-scrollbar max-h-36 overflow-y-auto rounded-md border px-3 py-1 text-xs" style={{ borderColor: theme.node.stroke }}>{preview.files.map((file) => <div key={file.path} className="flex justify-between gap-3 py-1"><span className="min-w-0 truncate font-mono">{file.path}</span><span className="shrink-0" style={{ color: theme.node.faint }}>{formatBytes(file.bytes)} · {file.sha256.slice(0, 12)}</span></div>)}</div></div>
                    <div><div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="size-3.5" />{t("agent.skillManager.installPermissions")}</div>{permissions.length ? <div className="space-y-2 rounded-md border p-3" style={{ borderColor: theme.node.stroke }}>{permissions.map((permission) => <Checkbox key={permission} checked={confirmed.includes(permission)} onChange={(event) => setConfirmed((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))}><span className="font-mono text-xs">{permission}</span></Checkbox>)}{preview.permissions.evidence.map((item) => <div key={item} className="pl-6 text-[11px]" style={{ color: theme.node.faint }}>{item}</div>)}</div> : <div className="text-xs" style={{ color: theme.node.muted }}>{t("agent.skillManager.installNoPermissions")}</div>}<div className="mt-2 text-[11px]" style={{ color: theme.node.faint }}>{t("agent.skillManager.installSafetyNote")}</div></div>
                </> : null}
            </div>
        </Modal>
    );
}

function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`; }
