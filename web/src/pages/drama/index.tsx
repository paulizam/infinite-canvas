import { Clapperboard, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Card, Empty, Form, Input, Modal, Skeleton, Space, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { cloudPlatform, type CloudDramaProject } from "@/services/cloud-platform";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";

type CreateFields = { title: string; sourceText?: string; sourceAssetId?: string };

export default function DramaPage() {
    const session = useCloudSessionStore();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<CreateFields>();
    const [projects, setProjects] = useState<CloudDramaProject[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        if (session.status !== "authenticated" || !session.activeWorkspaceId) return;
        setLoading(true);
        setError("");
        try {
            setProjects(await cloudPlatform.listDramaProjects(session.activeWorkspaceId));
        } catch (value) {
            setError(errorMessage(value));
        } finally {
            setLoading(false);
        }
    }, [session.activeWorkspaceId, session.status]);

    useEffect(() => void load(), [load]);

    const create = async () => {
        if (!session.activeWorkspaceId) return;
        const values = await form.validateFields();
        setCreating(true);
        try {
            const detail = await cloudPlatform.createDramaProject(session.activeWorkspaceId, cleanOptional(values));
            message.success(t("drama.created"));
            setOpen(false);
            form.resetFields();
            navigate(`/drama/${detail.project.id}`);
        } catch (value) {
            message.error(errorMessage(value));
        } finally {
            setCreating(false);
        }
    };

    if (session.status === "local" || session.status === "guest") {
        return <Guard message={t(session.status === "local" ? "drama.serverRequired" : "drama.loginRequired")} />;
    }

    return (
        <main className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-950">
            <div className="mx-auto max-w-6xl px-6 py-8">
                <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <Typography.Title level={2} className="!mb-1">{t("drama.title")}</Typography.Title>
                        <Typography.Text type="secondary">{t("drama.description")}</Typography.Text>
                    </div>
                    <Space>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()} loading={loading}>{t("drama.refresh")}</Button>
                        <Button type="primary" icon={<Plus className="size-4" />} disabled={!session.activeWorkspaceId} onClick={() => setOpen(true)}>{t("drama.create")}</Button>
                    </Space>
                </div>
                {error ? <Alert className="mb-5" type="error" showIcon message={t("drama.loadFailed")} description={error} /> : null}
                {loading ? <Skeleton active /> : projects.length ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <Card key={project.id} hoverable onClick={() => navigate(`/drama/${project.id}`)}>
                                <div className="flex items-start gap-3">
                                    <div className="rounded-lg bg-violet-100 p-2 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Clapperboard className="size-5" /></div>
                                    <div className="min-w-0 flex-1">
                                        <Typography.Title level={4} ellipsis className="!mb-1">{project.title}</Typography.Title>
                                        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} className="!mb-3 min-h-11">{project.sourceText || t("drama.noScript")}</Typography.Paragraph>
                                        <Typography.Text type="secondary" className="text-xs">Revision {project.revision} · {new Date(project.updatedAt).toLocaleString()}</Typography.Text>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : <Empty description={t("drama.empty")}><Button type="primary" onClick={() => setOpen(true)}>{t("drama.createFirst")}</Button></Empty>}
            </div>
            <Modal title={t("drama.modalCreate")} open={open} okText={t("drama.createAndEnter")} cancelText={t("drama.cancel")} confirmLoading={creating} onOk={() => void create()} onCancel={() => setOpen(false)} destroyOnHidden>
                <Form form={form} layout="vertical" className="pt-3">
                    <Form.Item name="title" label={t("drama.projectName")} rules={[{ required: true, whitespace: true, max: 160 }]}><Input autoFocus placeholder={t("drama.projectNamePlaceholder")} /></Form.Item>
                    <Form.Item name="sourceText" label={t("drama.sourceText")}><Input.TextArea rows={7} maxLength={2_000_000} showCount placeholder={t("drama.sourceTextPlaceholder")} /></Form.Item>
                    <Form.Item name="sourceAssetId" label={t("drama.sourceAssetId")} rules={[{ pattern: /^[0-9a-f-]{36}$/i, message: t("drama.invalidUuid") }]}><Input allowClear placeholder={t("drama.sourceAssetPlaceholder")} /></Form.Item>
                </Form>
            </Modal>
        </main>
    );
}

function Guard({ message }: { message: string }) {
    const { t } = useTranslation();
    return <main className="h-full overflow-y-auto p-8"><Alert type="info" showIcon message={message} action={<Button href="/account">{t("drama.goAccount")}</Button>} /></main>;
}
function cleanOptional(values: CreateFields) {
    return { title: values.title.trim(), ...(values.sourceText?.trim() ? { sourceText: values.sourceText.trim() } : {}), ...(values.sourceAssetId?.trim() ? { sourceAssetId: values.sourceAssetId.trim() } : {}) };
}
function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
