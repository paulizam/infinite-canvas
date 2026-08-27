import { App, Button, Empty, Input, List, Modal, Popconfirm, Tag } from "antd";
import { History, RotateCcw, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cloudModeEnabled, cloudPlatform, type CloudProjectCheckpoint } from "@/services/cloud-platform";
import { useCloudCanvasSyncStore } from "@/stores/use-cloud-canvas-sync-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export function CanvasCheckpointControl({ projectId, revision, readOnly, onRestored }: { projectId: string; revision: number; readOnly: boolean; onRestored: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checkpoints, setCheckpoints] = useState<CloudProjectCheckpoint[]>([]);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    if (!cloudModeEnabled) return null;

    const load = async () => {
        setLoading(true);
        try {
            setCheckpoints(await cloudPlatform.listProjectCheckpoints(projectId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("checkpoint.loadFailed"));
        } finally {
            setLoading(false);
        }
    };
    const show = () => {
        setOpen(true);
        void load();
    };
    const create = async () => {
        if (!name.trim()) return;
        setLoading(true);
        try {
            await cloudPlatform.createProjectCheckpoint(projectId, { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
            setName("");
            setDescription("");
            await load();
            message.success(t("checkpoint.created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("checkpoint.createFailed"));
            setLoading(false);
        }
    };
    const restore = async (checkpoint: CloudProjectCheckpoint) => {
        setLoading(true);
        try {
            const restored = await cloudPlatform.restoreProjectCheckpoint(projectId, checkpoint.id, revision);
            useCloudCanvasSyncStore.getState().acceptSnapshot(restored.document as unknown as CanvasProject);
            onRestored();
            setOpen(false);
            message.success(t("checkpoint.restored"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("checkpoint.restoreFailed"));
        } finally {
            setLoading(false);
        }
    };
    const remove = async (checkpointId: string) => {
        setLoading(true);
        try {
            await cloudPlatform.deleteProjectCheckpoint(projectId, checkpointId);
            await load();
            message.success(t("checkpoint.deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("checkpoint.deleteFailed"));
            setLoading(false);
        }
    };
    return (
        <>
            <Button icon={<History className="size-4" />} onClick={show}>
                {t("checkpoint.history")}
            </Button>
            <Modal title={t("checkpoint.title")} open={open} onCancel={() => setOpen(false)} footer={null} width={680} centered>
                {!readOnly ? (
                    <div className="mb-4 grid gap-2 rounded-xl border p-3">
                        <Input value={name} maxLength={120} placeholder={t("checkpoint.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
                        <Input.TextArea value={description} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("checkpoint.descriptionPlaceholder")} onChange={(event) => setDescription(event.target.value)} />
                        <Button type="primary" icon={<Save className="size-4" />} disabled={!name.trim()} loading={loading} onClick={() => void create()}>
                            {t("checkpoint.create")}
                        </Button>
                    </div>
                ) : null}
                <List
                    loading={loading}
                    dataSource={checkpoints}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("checkpoint.empty")} /> }}
                    renderItem={(checkpoint) => (
                        <List.Item
                            actions={
                                !readOnly
                                    ? [
                                          <Popconfirm key="restore" title={t("checkpoint.restoreConfirm")} onConfirm={() => void restore(checkpoint)}>
                                              <Button type="text" icon={<RotateCcw className="size-4" />}>
                                                  {t("checkpoint.restore")}
                                              </Button>
                                          </Popconfirm>,
                                          <Popconfirm key="delete" title={t("checkpoint.deleteConfirm")} onConfirm={() => void remove(checkpoint.id)}>
                                              <Button danger type="text" icon={<Trash2 className="size-4" />}>
                                                  {t("common.delete")}
                                              </Button>
                                          </Popconfirm>,
                                      ]
                                    : undefined
                            }
                        >
                            <List.Item.Meta
                                title={
                                    <span className="flex items-center gap-2">
                                        {checkpoint.name}
                                        <Tag>r{checkpoint.sourceRevision}</Tag>
                                    </span>
                                }
                                description={
                                    <div>
                                        <div>{checkpoint.description || t("checkpoint.noDescription")}</div>
                                        <div className="mt-1 text-xs">
                                            {t("checkpoint.preview", { title: checkpoint.snapshot.title, nodes: checkpoint.snapshot.nodes.length, connections: checkpoint.snapshot.connections.length })} · {new Date(checkpoint.createdAt).toLocaleString()}
                                        </div>
                                    </div>
                                }
                            />
                        </List.Item>
                    )}
                />
            </Modal>
        </>
    );
}
