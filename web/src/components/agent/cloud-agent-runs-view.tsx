import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Tag } from "antd";
import { Check, Play, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cloudPlatform, type CloudAgentRun, type CloudAgentRunDetail, type CloudAgentSession } from "@/services/cloud-platform";
import type { LogicalModel } from "@infinite-canvas/contracts";
import { useAgentStore } from "@/stores/use-agent-store";
import { applyAgentCanvasResult, deliverAgentAssetToDrama, type AgentRunResult } from "./agent-result-delivery";

export function CloudAgentRunsView({ workspaceId }: { workspaceId: string }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [deliveryForm] = Form.useForm();
    const [sessions, setSessions] = useState<CloudAgentSession[]>([]);
    const [sessionId, setSessionId] = useState<string>();
    const [runs, setRuns] = useState<CloudAgentRun[]>([]);
    const [selected, setSelected] = useState<CloudAgentRunDetail | null>(null);
    const [title, setTitle] = useState("");
    const [prompt, setPrompt] = useState("");
    const [models, setModels] = useState<LogicalModel[]>([]);
    const [modelId, setModelId] = useState<string>();
    const [skills, setSkills] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [deliveryResult, setDeliveryResult] = useState<AgentRunResult | null>(null);
    const [appliedResultIds, setAppliedResultIds] = useState(() => new Set<string>());
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const loadSessions = useCallback(async () => {
        const values = await cloudPlatform.listAgentSessions(workspaceId);
        setSessions(values);
        setSessionId((current) => current || values[0]?.id);
    }, [workspaceId]);
    const loadRuns = useCallback(async () => {
        if (!sessionId) {
            setRuns([]);
            return;
        }
        setRuns(await cloudPlatform.listAgentRuns(sessionId));
    }, [sessionId]);
    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            await loadSessions();
            await loadRuns();
            if (selected) setSelected(await cloudPlatform.getAgentRun(selected.run.id));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("agent.cloud.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [loadRuns, loadSessions, selected, t]);
    useEffect(() => {
        void loadSessions().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [loadSessions]);
    useEffect(() => {
        void cloudPlatform
            .listModels()
            .then((values) => {
                const eligible = values.filter((value) => value.enabled && value.capability === "text");
                setModels(eligible);
                setModelId((current) => current || eligible.find((value) => value.isDefault)?.id || eligible[0]?.id);
            })
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, []);
    useEffect(() => {
        void loadRuns().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [loadRuns]);
    const createSession = async () => {
        if (!title.trim()) return;
        setLoading(true);
        try {
            const value = await cloudPlatform.createAgentSession(workspaceId, { title: title.trim() });
            setTitle("");
            await loadSessions();
            setSessionId(value.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    };
    const createRun = async () => {
        if (!sessionId || !prompt.trim()) return;
        setLoading(true);
        try {
            const value = await cloudPlatform.createAgentRun(sessionId, { prompt: prompt.trim(), attachments: [], modelId, skillPolicy: { allow: skills }, maxAttempts: 3 });
            setPrompt("");
            setSelected(value);
            await loadRuns();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    };
    const mutate = async (action: () => Promise<CloudAgentRunDetail>) => {
        setLoading(true);
        try {
            setSelected(await action());
            await loadRuns();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    };
    const deliverToDrama = async () => {
        if (!deliveryResult) return;
        const values = await deliveryForm.validateFields();
        setLoading(true);
        try {
            await deliverAgentAssetToDrama(cloudPlatform, deliveryResult, {
                dramaId: String(values.dramaId),
                expectedDramaRevision: Number(values.expectedDramaRevision),
                target: { type: "entity", kind: values.kind as "character" | "scene" | "prop", name: String(values.name), description: String(values.description || ""), prompt: String(values.prompt || ""), sortOrder: Number(values.sortOrder) },
            });
            setDeliveryResult(null);
            deliveryForm.resetFields();
            message.success(t("agent.cloud.sentDrama"));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    };
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
            {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError(null)} /> : null}
            <div className="flex gap-2">
                <Select className="min-w-0 flex-1" value={sessionId} placeholder={t("agent.cloud.session")} options={sessions.map((value) => ({ value: value.id, label: value.title }))} onChange={setSessionId} />
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()} />
            </div>
            <div className="flex gap-2">
                <Input value={title} maxLength={200} placeholder={t("agent.cloud.newSession")} onChange={(event) => setTitle(event.target.value)} onPressEnter={() => void createSession()} />
                <Button disabled={!title.trim()} onClick={() => void createSession()}>
                    {t("agent.cloud.create")}
                </Button>
            </div>
            {sessionId ? (
                <div className="space-y-2 rounded-xl border p-3">
                    <Input.TextArea rows={3} maxLength={20_000} value={prompt} placeholder={t("agent.cloud.prompt")} onChange={(event) => setPrompt(event.target.value)} />
                    <div className="flex gap-2">
                        <Select className="min-w-0 flex-1" value={modelId} placeholder={t("agent.cloud.model")} options={models.map((value) => ({ value: value.id, label: value.name }))} onChange={setModelId} />
                        <Select mode="tags" className="min-w-0 flex-1" maxCount={20} value={skills} placeholder={t("agent.cloud.skills")} onChange={setSkills} />
                    </div>
                    <Button type="primary" block icon={<Play className="size-4" />} disabled={!prompt.trim()} loading={loading} onClick={() => void createRun()}>
                        {t("agent.cloud.run")}
                    </Button>
                </div>
            ) : null}
            <div className="space-y-2">
                {runs.map((run) => (
                    <button
                        type="button"
                        key={run.id}
                        className="w-full rounded-xl border p-3 text-left"
                        onClick={() =>
                            void cloudPlatform
                                .getAgentRun(run.id)
                                .then(setSelected)
                                .catch((cause) => setError(String(cause)))
                        }
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{run.prompt}</span>
                            <Tag color={statusColor(run.status)}>{run.status}</Tag>
                        </div>
                        <div className="mt-1 text-xs opacity-60">
                            #{run.attempt}/{run.maxAttempts} · {new Date(run.updatedAt).toLocaleString()}
                        </div>
                    </button>
                ))}
            </div>
            {selected ? (
                <section className="space-y-2 rounded-xl border p-3">
                    <div className="flex items-center justify-between">
                        <strong>{t("agent.cloud.detail")}</strong>
                        <div className="flex gap-1">
                            {!["succeeded", "failed", "cancelled"].includes(selected.run.status) ? <Button size="small" danger icon={<Square className="size-3" />} onClick={() => void mutate(() => cloudPlatform.cancelAgentRun(selected.run.id))} /> : null}
                            {selected.run.status === "failed" && selected.run.attempt < selected.run.maxAttempts ? (
                                <Button size="small" icon={<RotateCcw className="size-3" />} onClick={() => void mutate(() => cloudPlatform.retryAgentRun(selected.run.id))} />
                            ) : null}
                        </div>
                    </div>
                    {selected.run.error ? <Alert type="error" message={`${selected.run.error.code}: ${selected.run.error.message}`} /> : null}
                    {selected.approvals
                        .filter((value) => value.status === "pending")
                        .map((approval) => (
                            <div key={approval.id} className="rounded-lg border border-amber-400 p-2">
                                <div className="text-sm font-medium">{approval.action}</div>
                                <pre className="max-h-24 overflow-auto text-xs">{JSON.stringify(approval.request, null, 2)}</pre>
                                <div className="mt-2 flex gap-2">
                                    <Button size="small" danger icon={<X className="size-3" />} onClick={() => void mutate(() => cloudPlatform.decideAgentApproval(approval.id, "declined"))}>
                                        {t("agent.cloud.decline")}
                                    </Button>
                                    <Button size="small" type="primary" icon={<Check className="size-3" />} onClick={() => void mutate(() => cloudPlatform.decideAgentApproval(approval.id, "approved"))}>
                                        {t("agent.cloud.approve")}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    {selected.subtasks.map((task) => (
                        <div key={task.id} className="flex justify-between text-sm">
                            <span>{task.title}</span>
                            <Tag>{task.status}</Tag>
                        </div>
                    ))}
                    {selected.results.map((result) => (
                        <div key={result.id} className="rounded-lg bg-black/5 p-2 text-xs dark:bg-white/5">
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                                {result.kind}: {JSON.stringify(result.payload, null, 2)}
                            </pre>
                            {result.kind === "canvas_operation" && (Number.isInteger(result.payload.revision) || appliedResultIds.has(result.id)) ? <Tag className="mt-2">{t("agent.cloud.canvasApplied")}</Tag> : null}
                            {result.kind === "canvas_operation" && !Number.isInteger(result.payload.revision) && !appliedResultIds.has(result.id) && canvasContext && Array.isArray(result.payload.ops) ? (
                                <Button size="small" className="mt-2" onClick={() => { applyAgentCanvasResult(result, canvasContext); setAppliedResultIds((current) => new Set(current).add(result.id)); message.success(t("agent.cloud.canvasApplied")); }}>
                                    {t("agent.cloud.applyCanvas")}
                                </Button>
                            ) : null}
                            {result.assetId ? <div className="mt-2 flex flex-wrap gap-2"><Tag>Asset {result.assetId}</Tag><Button size="small" onClick={() => navigate("/assets")}>{t("agent.cloud.openAssets")}</Button><Button size="small" onClick={() => { setDeliveryResult(result); deliveryForm.setFieldsValue({ expectedDramaRevision: 0, kind: "prop", name: selected.run.prompt.slice(0, 160), sortOrder: 0 }); }}>{t("agent.cloud.sendDrama")}</Button></div> : null}
                        </div>
                    ))}
                </section>
            ) : null}
            <Modal title={t("agent.cloud.sendDrama")} open={Boolean(deliveryResult)} confirmLoading={loading} onCancel={() => setDeliveryResult(null)} onOk={() => void deliverToDrama()}>
                <Form form={deliveryForm} layout="vertical">
                    <Form.Item name="dramaId" label={t("agent.cloud.dramaId")} rules={[{ required: true }]}><Input maxLength={128} /></Form.Item>
                    <Form.Item name="expectedDramaRevision" label={t("agent.cloud.dramaRevision")} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
                    <Form.Item name="kind" label={t("agent.cloud.dramaEntityKind")} rules={[{ required: true }]}><Select options={["character", "scene", "prop"].map((value) => ({ value, label: t(`agent.cloud.${value}`) }))} /></Form.Item>
                    <Form.Item name="name" label={t("agent.cloud.dramaEntityName")} rules={[{ required: true }]}><Input maxLength={160} /></Form.Item>
                    <Form.Item name="description" label={t("agent.cloud.description")}><Input.TextArea maxLength={10_000} /></Form.Item>
                    <Form.Item name="prompt" label={t("agent.cloud.entityPrompt")}><Input.TextArea maxLength={20_000} /></Form.Item>
                    <Form.Item name="sortOrder" label={t("agent.cloud.sortOrder")} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
function statusColor(status: CloudAgentRun["status"]) {
    return status === "succeeded" ? "success" : status === "failed" || status === "cancelled" ? "error" : status === "waiting_approval" ? "warning" : "processing";
}
