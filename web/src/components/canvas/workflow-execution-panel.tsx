import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Select, Tag } from "antd";
import { LocateFixed, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cloudPlatform, type CloudWorkflowExecutionRecord, type CloudWorkflowPublication, type CloudWorkflowVersion } from "@/services/cloud-platform";

const activeStatuses = new Set(["queued", "running", "waiting", "cancel_requested"]);

export function WorkflowExecutionPanel({ publication, versions, onFocusNode, onClose }: { publication: CloudWorkflowPublication; versions: CloudWorkflowVersion[]; onFocusNode: (nodeId: string) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [executions, setExecutions] = useState<CloudWorkflowExecutionRecord[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [startNodeIds, setStartNodeIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selected = executions.find((record) => record.state.id === selectedId) || executions[0] || null;
    const definition = publication.version.definition as { nodes?: Array<{ id: string; type: string }> };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const records = await cloudPlatform.listWorkflowExecutions(publication.workflow.id);
            setExecutions(records);
            setSelectedId((current) => (current && records.some((item) => item.state.id === current) ? current : records[0]?.state.id || null));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.execution.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [publication.workflow.id, t]);

    useEffect(() => void load(), [load]);
    useEffect(() => {
        if (!selected || !activeStatuses.has(selected.state.status)) return;
        const timer = window.setInterval(() => {
            void cloudPlatform
                .getWorkflowExecution(selected.state.id)
                .then((record) => setExecutions((items) => [record, ...items.filter((item) => item.state.id !== record.state.id)]))
                .catch(() => undefined);
        }, 2_000);
        return () => window.clearInterval(timer);
    }, [selected?.state.id, selected?.state.status]);

    const run = async (selectedOnly: boolean) => {
        setLoading(true);
        setError(null);
        try {
            const result = await cloudPlatform.createWorkflowExecution(publication.workflow.id, {
                executionId: crypto.randomUUID(),
                version: publication.version.version,
                ...(selectedOnly ? { startNodeIds } : {}),
            });
            setExecutions((items) => [result.record, ...items]);
            setSelectedId(result.record.state.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.execution.runFailed"));
        } finally {
            setLoading(false);
        }
    };

    const replace = (record: CloudWorkflowExecutionRecord) => {
        setExecutions((items) => [record, ...items.filter((item) => item.state.id !== record.state.id)]);
        setSelectedId(record.state.id);
    };
    const cancel = async () => {
        if (!selected) return;
        setLoading(true);
        try {
            replace(await cloudPlatform.cancelWorkflowExecution(selected.state.id));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.execution.cancelFailed"));
        } finally {
            setLoading(false);
        }
    };
    const retry = async (nodeId: string) => {
        if (!selected) return;
        setLoading(true);
        try {
            replace(await cloudPlatform.retryWorkflowNode(selected.state.id, nodeId));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.execution.retryFailed"));
        } finally {
            setLoading(false);
        }
    };
    const mapping = useMemo(() => versions.find((version) => version.version === selected?.state.workflowVersion)?.sourceMapping.nodes || {}, [selected?.state.workflowVersion, versions]);

    return (
        <section className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{t("canvas.workflow.execution.title")}</h3>
                <div className="flex flex-wrap gap-2">
                    <Select
                        mode="multiple"
                        className="min-w-56"
                        value={startNodeIds}
                        onChange={setStartNodeIds}
                        placeholder={t("canvas.workflow.execution.selectNodes")}
                        options={(definition.nodes || []).map((node) => ({ value: node.id, label: `${node.id} · ${node.type}` }))}
                    />
                    <Button icon={<Play className="size-3.5" />} loading={loading} onClick={() => void run(false)}>
                        {t("canvas.workflow.execution.runAll")}
                    </Button>
                    <Button icon={<Play className="size-3.5" />} disabled={!startNodeIds.length} loading={loading} onClick={() => void run(true)}>
                        {t("canvas.workflow.execution.runSelected")}
                    </Button>
                    <Button icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load()} />
                </div>
            </div>
            {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} /> : null}
            <div className="grid min-h-80 gap-3 md:grid-cols-[220px_1fr]">
                <div className="max-h-[520px] space-y-2 overflow-auto rounded-lg border p-2">
                    {executions.length ? (
                        executions.map((record) => (
                            <button
                                key={record.state.id}
                                type="button"
                                className={`w-full rounded-lg border p-2 text-left text-xs ${selected?.state.id === record.state.id ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                                onClick={() => setSelectedId(record.state.id)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <Tag color={statusColor(record.state.status)}>{record.state.status}</Tag>
                                    <span>v{record.state.workflowVersion}</span>
                                </div>
                                <div className="mt-1 truncate font-mono" title={record.state.id}>
                                    {record.state.id}
                                </div>
                                <time className="opacity-60">{new Date(record.state.createdAt).toLocaleString()}</time>
                            </button>
                        ))
                    ) : (
                        <div className="p-6 text-center text-sm opacity-60">{t("canvas.workflow.execution.empty")}</div>
                    )}
                </div>
                {selected ? (
                    <div className="min-w-0 space-y-3">
                        <div className="flex items-center justify-between rounded-lg border p-2">
                            <div className="text-sm">
                                <Tag color={statusColor(selected.state.status)}>{selected.state.status}</Tag>
                                <span className="opacity-60">
                                    r{selected.revision} · {selected.state.selectedNodeIds.length} nodes
                                </span>
                            </div>
                            {activeStatuses.has(selected.state.status) && selected.state.status !== "cancel_requested" ? (
                                <Button danger size="small" icon={<Square className="size-3" />} loading={loading} onClick={() => void cancel()}>
                                    {t("canvas.workflow.execution.cancel")}
                                </Button>
                            ) : null}
                        </div>
                        <div className="grid max-h-52 gap-2 overflow-auto sm:grid-cols-2">
                            {Object.values(selected.state.nodes).map((node) => (
                                <div key={node.nodeId} className="rounded-lg border p-2 text-xs">
                                    <div className="flex items-center gap-1">
                                        <Tag color={statusColor(node.status)}>{node.status}</Tag>
                                        <span className="min-w-0 flex-1 truncate font-medium">{node.nodeId}</span>
                                        {mapping[node.nodeId] ? (
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={<LocateFixed className="size-3" />}
                                                onClick={() => {
                                                    onFocusNode(mapping[node.nodeId]!);
                                                    onClose();
                                                }}
                                            />
                                        ) : null}
                                        {node.status === "failed" ? <Button size="small" type="text" icon={<RotateCcw className="size-3" />} onClick={() => void retry(node.nodeId)} /> : null}
                                    </div>
                                    <div className="mt-1 opacity-60">
                                        attempt {node.attempt}/{node.maxAttempts}
                                        {node.skipReason ? ` · ${node.skipReason}` : ""}
                                    </div>
                                    {node.error ? (
                                        <div className="mt-1 text-red-600">
                                            {node.error.code}: {node.error.message}
                                        </div>
                                    ) : null}
                                    {node.input !== undefined || node.output !== undefined ? (
                                        <details className="mt-1">
                                            <summary className="cursor-pointer">{t("canvas.workflow.execution.snapshots")}</summary>
                                            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-1 dark:bg-white/5">{json({ input: node.input, output: node.output, steps: node.steps })}</pre>
                                        </details>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                        <div>
                            <h4 className="mb-1 text-sm font-medium">{t("canvas.workflow.execution.timeline")}</h4>
                            <div className="max-h-56 space-y-1 overflow-auto rounded-lg border p-2">
                                {[...selected.state.events].reverse().map((event) => (
                                    <div key={event.sequence} className="grid grid-cols-[52px_1fr_auto] gap-2 border-b py-1 text-xs last:border-0">
                                        <span className="font-mono opacity-50">#{event.sequence}</span>
                                        <div className="min-w-0">
                                            <span className="font-medium">{event.type}</span>
                                            {event.nodeId ? <span className="ml-2 opacity-60">{event.nodeId}</span> : null}
                                            {event.data ? <pre className="truncate opacity-60">{json(event.data)}</pre> : null}
                                        </div>
                                        <time className="opacity-50">{new Date(event.createdAt).toLocaleTimeString()}</time>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function statusColor(status: string) {
    if (status === "succeeded") return "success";
    if (status === "failed") return "error";
    if (status === "cancelled" || status === "skipped") return "default";
    if (status === "waiting" || status === "cancel_requested") return "warning";
    return "processing";
}
function json(value: unknown) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return "[unserializable]";
    }
}
