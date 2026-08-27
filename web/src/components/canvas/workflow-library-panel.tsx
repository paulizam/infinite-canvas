import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select, Switch, Tag } from "antd";
import { Copy, Download, FolderPlus, Settings, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cloudPlatform, type CloudWorkflowBundle, type CloudWorkflowLibrary, type CloudWorkflowLibraryMetadata } from "@/services/cloud-platform";

export function WorkflowLibraryPanel({ workspaceId, currentWorkflowId }: { workspaceId: string; currentWorkflowId?: string }) {
    const { t } = useTranslation();
    const fileRef = useRef<HTMLInputElement>(null);
    const [library, setLibrary] = useState<CloudWorkflowLibrary>({ folders: [], workflows: [] });
    const [folderName, setFolderName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ workflowId: string; metadata: CloudWorkflowLibraryMetadata } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setLibrary(await cloudPlatform.getWorkflowLibrary(workspaceId));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.library.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [t, workspaceId]);
    useEffect(() => void load(), [load]);

    const createFolder = async () => {
        if (!folderName.trim()) return;
        setLoading(true);
        try {
            await cloudPlatform.createWorkflowFolder(workspaceId, folderName.trim());
            setFolderName("");
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.library.folderFailed"));
            setLoading(false);
        }
    };
    const patch = async (workflowId: string, value: Parameters<typeof cloudPlatform.updateWorkflowLibrary>[1]) => {
        setLoading(true);
        try {
            await cloudPlatform.updateWorkflowLibrary(workflowId, value);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.library.updateFailed"));
            setLoading(false);
        }
    };
    const exportBundle = async (workflowId: string, name: string) => {
        setLoading(true);
        try {
            downloadBundle(await cloudPlatform.exportWorkflow(workflowId), name);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.library.exportFailed"));
        } finally {
            setLoading(false);
        }
    };
    const importFile = async (file?: File) => {
        if (!file) return;
        setLoading(true);
        setError(null);
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error(t("canvas.workflow.library.tooLarge"));
            const bundle = JSON.parse(await file.text()) as CloudWorkflowBundle;
            await cloudPlatform.importWorkflow(workspaceId, bundle);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.library.importFailed"));
            setLoading(false);
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    return (
        <section className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{t("canvas.workflow.library.title")}</h3>
                <div className="flex gap-2">
                    <Input className="w-40" value={folderName} maxLength={120} placeholder={t("canvas.workflow.library.folderName")} onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void createFolder()} />
                    <Button icon={<FolderPlus className="size-3.5" />} disabled={!folderName.trim()} loading={loading} onClick={() => void createFolder()} />
                    <Button icon={<Upload className="size-3.5" />} loading={loading} onClick={() => fileRef.current?.click()}>
                        {t("canvas.workflow.library.import")}
                    </Button>
                    <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0])} />
                </div>
            </div>
            {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError(null)} /> : null}
            {library.folders.length ? (
                <div className="flex flex-wrap gap-1">
                    {library.folders.map((folder) => (
                        <Tag
                            key={folder.id}
                            closable
                            closeIcon={<Trash2 className="size-3" />}
                            onClose={(event) => {
                                event.preventDefault();
                                void cloudPlatform
                                    .deleteWorkflowFolder(folder.id)
                                    .then(load)
                                    .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
                            }}
                        >
                            {folder.name}
                        </Tag>
                    ))}
                </div>
            ) : null}
            <div className="grid max-h-[420px] gap-2 overflow-auto md:grid-cols-2">
                {library.workflows.map(({ workflow, metadata }) => (
                    <div key={workflow.id} className={`flex gap-3 rounded-xl border p-3 ${workflow.id === currentWorkflowId ? "border-blue-500" : ""}`}>
                        <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-black/5 dark:bg-white/5">
                            {metadata.coverAssetId ? <img className="size-full object-cover" src={cloudPlatform.assetContentUrl(metadata.coverAssetId)} alt="" /> : <div className="grid size-full place-items-center text-xs opacity-40">Workflow</div>}
                        </div>
                        <div className="min-w-0 flex-1 text-xs">
                            <div className="flex items-center gap-1">
                                <strong className="truncate text-sm">{workflow.name}</strong>
                                {metadata.isTemplate ? <Tag color="purple">Template</Tag> : null}
                                {workflow.projectId === null ? <Tag>Imported</Tag> : null}
                            </div>
                            <div className="mt-1 opacity-60">
                                v{workflow.currentVersion} · {metadata.description || t("canvas.workflow.library.noDescription")}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                                <Select
                                    size="small"
                                    className="w-28"
                                    allowClear
                                    value={metadata.folderId || undefined}
                                    placeholder={t("canvas.workflow.library.folder")}
                                    options={library.folders.map((folder) => ({ value: folder.id, label: folder.name }))}
                                    onChange={(folderId) => void patch(workflow.id, { folderId: folderId || null })}
                                />
                                <Switch size="small" checked={metadata.isTemplate} onChange={(isTemplate) => void patch(workflow.id, { isTemplate })} />
                                <Button size="small" type="text" icon={<Settings className="size-3" />} onClick={() => setEditing({ workflowId: workflow.id, metadata: { ...metadata } })} />
                                <Button size="small" type="text" icon={<Download className="size-3" />} onClick={() => void exportBundle(workflow.id, workflow.name)} />
                                {metadata.isTemplate ? (
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<Copy className="size-3" />}
                                        onClick={() =>
                                            void cloudPlatform
                                                .instantiateWorkflowTemplate(workflow.id, `${workflow.name} Copy`)
                                                .then(load)
                                                .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
                                        }
                                    />
                                ) : null}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <Modal
                title={t("canvas.workflow.library.edit")}
                open={Boolean(editing)}
                onCancel={() => setEditing(null)}
                onOk={() => {
                    if (editing) void patch(editing.workflowId, { description: editing.metadata.description, tags: editing.metadata.tags, coverAssetId: editing.metadata.coverAssetId }).then(() => setEditing(null));
                }}
                okButtonProps={{ loading }}
            >
                {editing ? (
                    <div className="space-y-3 pt-2">
                        <Input.TextArea
                            rows={3}
                            maxLength={2000}
                            value={editing.metadata.description}
                            placeholder={t("canvas.workflow.library.description")}
                            onChange={(event) => setEditing({ ...editing, metadata: { ...editing.metadata, description: event.target.value } })}
                        />
                        <Select mode="tags" className="w-full" maxCount={20} value={editing.metadata.tags} placeholder={t("canvas.workflow.library.tags")} onChange={(tags) => setEditing({ ...editing, metadata: { ...editing.metadata, tags } })} />
                        <Input
                            value={editing.metadata.coverAssetId || ""}
                            placeholder={t("canvas.workflow.library.coverAsset")}
                            onChange={(event) => setEditing({ ...editing, metadata: { ...editing.metadata, coverAssetId: event.target.value.trim() || null } })}
                        />
                    </div>
                ) : null}
            </Modal>
        </section>
    );
}

export function downloadBundle(bundle: CloudWorkflowBundle, name: string) {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName(name)}.workflow.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}
function safeName(name: string) {
    return (
        name
            .replace(/[^\p{L}\p{N}._-]+/gu, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "workflow"
    );
}
