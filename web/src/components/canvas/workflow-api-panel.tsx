import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Select, Tag } from "antd";
import { Copy, KeyRound, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cloudApiBaseUrl, cloudPlatform, type CloudWorkflowApiCredential, type CloudWorkflowApiScope, type CloudWorkflowApiToken } from "@/services/cloud-platform";

export function WorkflowApiPanel({ workflowId }: { workflowId: string }) {
    const { t } = useTranslation();
    const [tokens, setTokens] = useState<CloudWorkflowApiToken[]>([]);
    const [name, setName] = useState("");
    const [scopes, setScopes] = useState<CloudWorkflowApiScope[]>(["invoke", "read_execution"]);
    const [rate, setRate] = useState(60);
    const [credential, setCredential] = useState<CloudWorkflowApiCredential | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setTokens(await cloudPlatform.listWorkflowApiTokens(workflowId));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.api.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [t, workflowId]);
    useEffect(() => void load(), [load]);
    const create = async () => {
        if (!name.trim() || !scopes.length) return;
        setLoading(true);
        setError(null);
        try {
            setCredential(await cloudPlatform.createWorkflowApiToken(workflowId, { name: name.trim(), scopes, rateLimitPerMinute: rate }));
            setName("");
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.api.createFailed"));
            setLoading(false);
        }
    };
    const rotate = async (tokenId: string) => {
        setLoading(true);
        try {
            setCredential(await cloudPlatform.rotateWorkflowApiToken(tokenId));
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.api.rotateFailed"));
            setLoading(false);
        }
    };
    const revoke = async (tokenId: string) => {
        setLoading(true);
        try {
            await cloudPlatform.revokeWorkflowApiToken(tokenId);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("canvas.workflow.api.revokeFailed"));
            setLoading(false);
        }
    };
    const snippet = useMemo(() => (credential ? workflowApiCurlSnippet(credential.secret, cloudApiBaseUrl || window.location.origin) : ""), [credential]);
    return (
        <section className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
                <h3 className="font-medium">{t("canvas.workflow.api.title")}</h3>
                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load()} />
            </div>
            {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError(null)} /> : null}
            <div className="flex flex-wrap gap-2 rounded-xl border p-3">
                <Input className="min-w-40 flex-1" maxLength={120} value={name} placeholder={t("canvas.workflow.api.name")} onChange={(event) => setName(event.target.value)} />
                <Select<CloudWorkflowApiScope[]>
                    mode="multiple"
                    className="min-w-56"
                    value={scopes}
                    options={[
                        { value: "invoke", label: "invoke" },
                        { value: "read_execution", label: "read_execution" },
                    ]}
                    onChange={setScopes}
                />
                <InputNumber min={1} max={600} value={rate} addonAfter="/ min" onChange={(value) => setRate(value || 60)} />
                <Button type="primary" icon={<KeyRound className="size-4" />} disabled={!name.trim() || !scopes.length} loading={loading} onClick={() => void create()}>
                    {t("canvas.workflow.api.create")}
                </Button>
            </div>
            <div className="max-h-64 divide-y overflow-auto rounded-lg border">
                {tokens.map((token) => (
                    <div key={token.id} className="flex items-center gap-3 p-3 text-sm">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <strong className="truncate">{token.name}</strong>
                                <code>{token.tokenPrefix}…</code>
                                {token.revokedAt ? <Tag color="default">revoked</Tag> : null}
                            </div>
                            <div className="mt-1 opacity-60">
                                v{token.workflowVersion} · {token.scopes.join(", ")} · {token.rateLimitPerMinute}/min
                            </div>
                        </div>
                        {!token.revokedAt ? (
                            <>
                                <Button type="text" icon={<RotateCw className="size-4" />} aria-label={t("canvas.workflow.api.rotate")} onClick={() => void rotate(token.id)} />
                                <Button danger type="text" icon={<Trash2 className="size-4" />} aria-label={t("canvas.workflow.api.revoke")} onClick={() => void revoke(token.id)} />
                            </>
                        ) : null}
                    </div>
                ))}
            </div>
            <Modal title={t("canvas.workflow.api.secretTitle")} open={Boolean(credential)} footer={null} onCancel={() => setCredential(null)} destroyOnHidden>
                <Alert type="warning" showIcon message={t("canvas.workflow.api.secretOnce")} />
                <Input.Password className="mt-3" readOnly value={credential?.secret} addonAfter={<Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyText(credential?.secret || "")} />} />
                <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-black p-3 text-xs text-white">{snippet}</pre>
                <Button className="mt-2" icon={<Copy className="size-3.5" />} onClick={() => void copyText(snippet)}>
                    {t("canvas.workflow.api.copySnippet")}
                </Button>
            </Modal>
        </section>
    );
}

export function workflowApiCurlSnippet(secret: string, origin = typeof window === "undefined" ? "https://api.example.com" : window.location.origin) {
    return `curl -X POST '${origin}/api/v1/public/workflows/invoke' \\\n+  -H 'Authorization: Bearer ${secret}' \\\n+  -H 'Idempotency-Key: replace-with-unique-request-id' \\\n+  -H 'Content-Type: application/json' \\\n+  --data '{"prompt":"Hello"}'`;
}
async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
}
