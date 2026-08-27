import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Modal, Tag } from "antd";
import { GitBranch, LocateFixed, RefreshCw, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cloudModeEnabled, cloudPlatform, type CloudWorkflowPublication, type CloudWorkflowVersion, type WorkflowCompileIssue } from "@/services/cloud-platform";

export function CanvasWorkflowPublisher({ projectId, projectRevision, projectName, onFocusNode }: { projectId: string; projectRevision: number; projectName: string; onFocusNode: (nodeId: string) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [current, setCurrent] = useState<CloudWorkflowPublication | null>(null);
    const [versions, setVersions] = useState<CloudWorkflowVersion[]>([]);
    const [issues, setIssues] = useState<WorkflowCompileIssue[]>([]);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!cloudModeEnabled) return;
        setLoading(true);
        setError(null);
        try {
            const publication = await cloudPlatform.getProjectWorkflow(projectId);
            setCurrent(publication);
            setVersions(publication ? await cloudPlatform.listWorkflowVersions(publication.workflow.id) : []);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [projectId, t]);

    useEffect(() => {
        if (open) void load();
    }, [load, open]);

    const publish = async () => {
        setLoading(true);
        setError(null);
        setIssues([]);
        try {
            const result = await cloudPlatform.publishWorkflow(projectId, {
                publicationId: crypto.randomUUID(),
                expectedProjectRevision: projectRevision,
                name: projectName,
            });
            setIssues(result.compile.issues);
            if (result.publication) {
                setCurrent(result.publication);
                setVersions(await cloudPlatform.listWorkflowVersions(result.publication.workflow.id));
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.publishFailed"));
        } finally {
            setLoading(false);
        }
    };

    if (!cloudModeEnabled) return null;
    return (
        <>
            <Button type="text" className="!h-10 !rounded-xl !px-3 !font-medium" icon={<GitBranch className="size-4" />} onClick={() => setOpen(true)}>
                {t("canvas.workflow.button")}
            </Button>
            <Modal title={t("canvas.workflow.title")} open={open} width={720} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
                <div className="space-y-4 pt-2">
                    {error ? <Alert type="error" showIcon message={error} /> : null}
                    <div className="flex items-center justify-between rounded-xl border p-3">
                        <div>
                            <div className="font-medium">{current ? `${current.workflow.name} · v${current.workflow.currentVersion}` : t("canvas.workflow.unpublished")}</div>
                            <div className="mt-1 text-xs opacity-60">{t("canvas.workflow.canvasRevision", { revision: projectRevision })}</div>
                        </div>
                        <div className="flex gap-2">
                            <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                                {t("canvas.workflow.refresh")}
                            </Button>
                            <Button type="primary" icon={<Rocket className="size-4" />} loading={loading} onClick={() => void publish()}>
                                {t("canvas.workflow.publish")}
                            </Button>
                        </div>
                    </div>
                    {issues.length ? (
                        <section>
                            <h3 className="mb-2 font-medium">{t("canvas.workflow.diagnostics")}</h3>
                            <div className="max-h-48 space-y-2 overflow-auto">
                                {issues.map((issue, index) => (
                                    <div key={`${issue.code}-${index}`} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                                        <Tag color={issue.severity === "error" ? "error" : "warning"}>{issue.severity}</Tag>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium">{issue.code}</div>
                                            <div className="opacity-70">{issue.message}</div>
                                        </div>
                                        {issue.canvasNodeId ? (
                                            <Button
                                                size="small"
                                                icon={<LocateFixed className="size-3.5" />}
                                                onClick={() => {
                                                    onFocusNode(issue.canvasNodeId!);
                                                    setOpen(false);
                                                }}
                                            >
                                                {t("canvas.workflow.locate")}
                                            </Button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <section>
                        <h3 className="mb-2 font-medium">{t("canvas.workflow.history")}</h3>
                        {versions.length ? (
                            <div className="max-h-56 divide-y overflow-auto rounded-lg border">
                                {versions.map((version) => (
                                    <div key={version.version} className="flex items-center justify-between p-3 text-sm">
                                        <span className="font-medium">v{version.version}</span>
                                        <span className="opacity-60">Canvas r{version.projectRevision}</span>
                                        <time className="opacity-60">{new Date(version.createdAt).toLocaleString()}</time>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed p-6 text-center text-sm opacity-60">{t("canvas.workflow.noVersions")}</div>
                        )}
                    </section>
                </div>
            </Modal>
        </>
    );
}
