import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, Select, Tag } from "antd";
import { Check, Play, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cloudPlatform, type CloudAgentRun, type CloudAgentRunDetail, type CloudAgentSession } from "@/services/cloud-platform";

export function CloudAgentRunsView({ workspaceId }: { workspaceId: string }) {
    const { t } = useTranslation();
    const [sessions, setSessions] = useState<CloudAgentSession[]>([]);
    const [sessionId, setSessionId] = useState<string>();
    const [runs, setRuns] = useState<CloudAgentRun[]>([]);
    const [selected, setSelected] = useState<CloudAgentRunDetail | null>(null);
    const [title, setTitle] = useState("");
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
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
            const value = await cloudPlatform.createAgentRun(sessionId, { prompt: prompt.trim(), attachments: [], skillPolicy: {}, maxAttempts: 3 });
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
                        <pre key={result.id} className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-2 text-xs dark:bg-white/5">
                            {result.kind}: {JSON.stringify(result.payload, null, 2)}
                        </pre>
                    ))}
                </section>
            ) : null}
        </div>
    );
}
function statusColor(status: CloudAgentRun["status"]) {
    return status === "succeeded" ? "success" : status === "failed" || status === "cancelled" ? "error" : status === "waiting_approval" ? "warning" : "processing";
}
