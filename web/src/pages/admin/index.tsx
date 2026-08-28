import { Alert, Button, Card, Col, Form, Input, InputNumber, Popconfirm, Row, Segmented, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminPlatform, type AdminAudit, type AdminContent, type AdminDashboard, type AdminJob, type AdminSetting, type AdminUser } from "@/services/admin-platform";
import { CommerceAdmin, ModelAdmin } from "./model-commerce";

export default function AdminPage() {
    const [dashboard, setDashboard] = useState<AdminDashboard | null>(null),
        [users, setUsers] = useState<AdminUser[]>([]),
        [jobs, setJobs] = useState<AdminJob[]>([]),
        [storage, setStorage] = useState<Record<string, unknown>>({}),
        [audit, setAudit] = useState<AdminAudit[]>([]),
        [settings, setSettings] = useState<AdminSetting[]>([]),
        [content, setContent] = useState<AdminContent[]>([]),
        [mfa, setMfa] = useState<{ enabled: boolean; sessionVerified: boolean; verifiedAt: string | null } | null>(null),
        [error, setError] = useState<string | null>(null),
        [loading, setLoading] = useState(true);
    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [d, u, j, s, a, cfg, ops] = await Promise.all([adminPlatform.dashboard(), adminPlatform.users(), adminPlatform.jobs(), adminPlatform.storage(), adminPlatform.audit(), adminPlatform.settings(), adminPlatform.content()]);
            setDashboard(d);
            setUsers(u.items);
            setJobs(j);
            setStorage(s);
            setAudit(a);
            setSettings(cfg);
            setContent(ops);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);
    const initialize = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const status = await adminPlatform.mfaStatus();
            setMfa(status);
            if (status.sessionVerified) await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [refresh]);
    useEffect(() => {
        void initialize();
    }, [initialize]);
    const mutate = async (action: () => Promise<unknown>) => {
        try {
            await action();
            message.success("操作已完成");
            await refresh();
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        }
    };
    const items = useMemo(
        () => [
            { key: "dashboard", label: "Dashboard", children: <Dashboard value={dashboard} storage={storage} /> },
            { key: "users", label: "用户与 Session", children: <Users rows={users} busy={loading} mutate={mutate} /> },
            { key: "jobs", label: "生成任务", children: <Jobs rows={jobs} busy={loading} mutate={mutate} /> },
            { key: "models", label: "模型渠道", children: <ModelAdmin /> },
            { key: "commerce", label: "商业运营", children: <CommerceAdmin /> },
            { key: "settings", label: "站点配置", children: <Settings rows={settings} mutate={mutate} /> },
            { key: "governance", label: "运营治理", children: <Governance rows={content} mutate={mutate} /> },
            { key: "audit", label: "审计日志", children: <Audit rows={audit} /> },
        ],
        [dashboard, storage, users, jobs, settings, content, audit, loading],
    );
    return (
        <main className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-950">
            <div className="mx-auto max-w-7xl px-6 py-7">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <Space>
                            <ShieldCheck className="size-6" />
                            <Typography.Title level={3} className="!mb-0">
                                平台管理后台
                            </Typography.Title>
                        </Space>
                        <Typography.Text type="secondary">系统健康、用户、任务、商业运营、配置与审计控制面</Typography.Text>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                        刷新
                    </Button>
                </div>
                {error ? <Alert className="mb-5" type="error" showIcon message="无法进入管理后台" description={error} /> : !mfa?.sessionVerified ? <MfaGate status={mfa} onVerified={initialize} /> : <Tabs items={items} />}
            </div>
        </main>
    );
}
function MfaGate({ status, onVerified }: { status: { enabled: boolean; sessionVerified: boolean } | null; onVerified: () => Promise<void> }) {
    const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null),
        [recovery, setRecovery] = useState<string[]>([]),
        [busy, setBusy] = useState(false);
    const submit = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await fn();
            await onVerified();
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    const confirm = async (code: string) => {
        setBusy(true);
        try {
            const x = await adminPlatform.mfaConfirm(code);
            setRecovery(x.recoveryCodes);
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    if (!status) return <Card loading />;
    if (recovery.length)
        return (
            <Card title="MFA 已启用">
                <Alert type="warning" showIcon message="立即保存以下恢复码；关闭后不再显示。" />
                <pre className="my-4 grid grid-cols-2 gap-2 rounded bg-stone-950 p-4 text-white">{recovery.join("\n")}</pre>
                <Button type="primary" onClick={() => void onVerified()}>
                    我已安全保存
                </Button>
            </Card>
        );
    if (!status.enabled)
        return (
            <Card className="max-w-2xl" title="管理员必须启用 MFA">
                {!enrollment ? (
                    <Button type="primary" loading={busy} onClick={() => void submit(async () => setEnrollment(await adminPlatform.mfaEnroll()))}>
                        开始配置 TOTP
                    </Button>
                ) : (
                    <>
                        <Alert type="info" message="在 Authenticator 中导入以下 otpauth URI 或 Secret" />
                        <Typography.Paragraph className="mt-3" copyable={{ text: enrollment.otpauthUri }}>
                            <code className="break-all">{enrollment.otpauthUri}</code>
                        </Typography.Paragraph>
                        <Typography.Text copyable>{enrollment.secret}</Typography.Text>
                        <Form className="mt-4" layout="vertical" onFinish={(x) => void confirm(x.code)}>
                            <Form.Item name="code" label="6 位验证码" rules={[{ required: true, pattern: /^\d{6}$/ }]}>
                                <Input inputMode="numeric" maxLength={6} />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" loading={busy}>
                                验证并启用
                            </Button>
                        </Form>
                    </>
                )}
            </Card>
        );
    return (
        <Card className="max-w-md" title="验证管理员 MFA">
            <Tabs
                items={[
                    {
                        key: "totp",
                        label: "Authenticator",
                        children: (
                            <Form layout="vertical" onFinish={(x) => void submit(() => adminPlatform.mfaVerify({ code: x.code }))}>
                                <Form.Item name="code" label="6 位验证码" rules={[{ required: true, pattern: /^\d{6}$/ }]}>
                                    <Input inputMode="numeric" maxLength={6} />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" loading={busy}>
                                    验证
                                </Button>
                            </Form>
                        ),
                    },
                    {
                        key: "recovery",
                        label: "恢复码",
                        children: (
                            <Form layout="vertical" onFinish={(x) => void submit(() => adminPlatform.mfaVerify({ recoveryCode: x.code }))}>
                                <Form.Item name="code" label="一次性恢复码" rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" loading={busy}>
                                    使用恢复码
                                </Button>
                            </Form>
                        ),
                    },
                ]}
            />
        </Card>
    );
}
function Dashboard({ value, storage }: { value: AdminDashboard | null; storage: Record<string, unknown> }) {
    const cards = [
        ["用户", value?.users?.total],
        ["排队任务", value?.jobs?.queued],
        ["失败任务", value?.jobs?.failed],
        ["待复核", value?.jobs?.needs_review],
        ["资产", storage.assets],
        ["存储字节", storage.bytes],
        ["订单", value?.billing?.orders],
        ["收入（分）", value?.billing?.revenue_minor],
    ];
    return (
        <Row gutter={[16, 16]}>
            {cards.map(([label, v]) => (
                <Col xs={12} md={6} key={String(label)}>
                    <Card>
                        <Statistic title={String(label)} value={Number(v || 0)} />
                    </Card>
                </Col>
            ))}
        </Row>
    );
}
function Users({ rows, busy, mutate }: { rows: AdminUser[]; busy: boolean; mutate: (x: () => Promise<unknown>) => Promise<void> }) {
    return (
        <Table
            rowKey="id"
            loading={busy}
            dataSource={rows}
            scroll={{ x: 1000 }}
            columns={[
                {
                    title: "用户",
                    render: (_, x) => (
                        <div>
                            <b>{x.name}</b>
                            <div className="text-xs text-stone-500">{x.email}</div>
                        </div>
                    ),
                },
                { title: "状态", dataIndex: "status", render: (x) => <Tag color={x === "active" ? "green" : "red"}>{x}</Tag> },
                { title: "平台角色", dataIndex: "platformRole" },
                { title: "积分", dataIndex: "balanceUnits" },
                { title: "Session", dataIndex: "activeSessions" },
                { title: "Workspace", dataIndex: "workspaces" },
                {
                    title: "操作",
                    render: (_, x) => (
                        <Space wrap>
                            <Popconfirm title={`确认${x.status === "active" ? "停用" : "恢复"}用户？`} onConfirm={() => void mutate(() => adminPlatform.updateUser(x.id, { status: x.status === "active" ? "suspended" : "active" }))}>
                                <Button size="small" danger={x.status === "active"}>
                                    {x.status === "active" ? "停用" : "恢复"}
                                </Button>
                            </Popconfirm>
                            <Button size="small" onClick={() => void mutate(() => adminPlatform.updateUser(x.id, { platformRole: x.platformRole === "admin" ? "user" : "admin" }))}>
                                {x.platformRole === "admin" ? "撤销管理员" : "设为管理员"}
                            </Button>
                            <Button size="small" onClick={() => void mutate(() => adminPlatform.revokeSessions(x.id))}>
                                撤销 Session
                            </Button>
                        </Space>
                    ),
                },
            ]}
        />
    );
}
function Jobs({ rows, busy, mutate }: { rows: AdminJob[]; busy: boolean; mutate: (x: () => Promise<unknown>) => Promise<void> }) {
    return (
        <Table
            rowKey="id"
            loading={busy}
            dataSource={rows}
            scroll={{ x: 1200 }}
            columns={[
                { title: "ID", dataIndex: "id", ellipsis: true, width: 180 },
                { title: "能力", dataIndex: "capability" },
                { title: "模型", dataIndex: "logicalModelId" },
                {
                    title: "状态",
                    render: (_, x) => (
                        <>
                            <Tag>{x.status}</Tag>
                            <small>{x.phase}</small>
                        </>
                    ),
                },
                { title: "Attempt", dataIndex: "attempt" },
                { title: "Provider", dataIndex: "provider" },
                { title: "错误", render: (_, x) => <span title={x.errorMessage || ""}>{x.errorCode || "-"}</span> },
                {
                    title: "操作",
                    render: (_, x) => (
                        <Space>
                            <Button size="small" onClick={() => void mutate(() => adminPlatform.jobAction(x.id, x.status === "needs_review" ? "review" : "requeue"))}>
                                恢复
                            </Button>
                            <Button size="small" danger onClick={() => void mutate(() => adminPlatform.jobAction(x.id, "cancel"))}>
                                取消
                            </Button>
                        </Space>
                    ),
                },
            ]}
        />
    );
}
function Settings({ rows, mutate }: { rows: AdminSetting[]; mutate: (x: () => Promise<unknown>) => Promise<void> }) {
    const current = (n: string, k: string) => rows.find((x) => x.namespace === n && x.key === k);
    return (
        <Card title="保存前执行类型、范围与 URL 安全校验；Secret 永不回显">
            <Form
                layout="vertical"
                initialValues={{ brandName: current("site", "brandName")?.value || "Infinite Canvas", registrationEnabled: current("site", "registrationEnabled")?.value ?? true, maxConcurrency: current("generation", "maxConcurrency")?.value || 10 }}
                onFinish={(x) =>
                    void mutate(async () => {
                        await adminPlatform.saveSetting("site", "brandName", { value: x.brandName, expectedRevision: current("site", "brandName")?.revision || 0 });
                        await adminPlatform.saveSetting("site", "registrationEnabled", { value: x.registrationEnabled, expectedRevision: current("site", "registrationEnabled")?.revision || 0 });
                        await adminPlatform.saveSetting("generation", "maxConcurrency", { value: x.maxConcurrency, expectedRevision: current("generation", "maxConcurrency")?.revision || 0 });
                    })
                }
            >
                <Form.Item name="brandName" label="品牌名称" rules={[{ required: true, max: 80 }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="registrationEnabled" label="开放注册" valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Form.Item name="maxConcurrency" label="生成并发">
                    <InputNumber min={1} max={1000} />
                </Form.Item>
                <Button type="primary" htmlType="submit">
                    校验并保存
                </Button>
            </Form>
        </Card>
    );
}
function Governance({ rows, mutate }: { rows: AdminContent[]; mutate: (x: () => Promise<unknown>) => Promise<void> }) {
    return (
        <Row gutter={16}>
            <Col xs={24} lg={9}>
                <Card title="发布公告 / 运营提示词">
                    <Form layout="vertical" onFinish={(x) => void mutate(() => adminPlatform.saveContent(x))} initialValues={{ kind: "announcement", status: "draft" }}>
                        <Form.Item name="kind" label="类型">
                            <Segmented
                                options={[
                                    { label: "公告", value: "announcement" },
                                    { label: "提示词", value: "prompt" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, max: 160 }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="content" label="内容" rules={[{ required: true }]}>
                            <Input.TextArea rows={6} />
                        </Form.Item>
                        <Form.Item name="status" label="状态">
                            <Select options={["draft", "published", "archived"].map((value) => ({ value, label: value }))} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit">
                            保存
                        </Button>
                    </Form>
                </Card>
            </Col>
            <Col xs={24} lg={15}>
                <Table
                    rowKey="id"
                    dataSource={rows}
                    columns={[
                        { title: "类型", dataIndex: "kind" },
                        { title: "标题", dataIndex: "title" },
                        { title: "状态", dataIndex: "status", render: (x) => <Tag>{x}</Tag> },
                        { title: "版本", dataIndex: "revision" },
                        { title: "更新时间", dataIndex: "updatedAt" },
                    ]}
                />
            </Col>
        </Row>
    );
}
function Audit({ rows }: { rows: AdminAudit[] }) {
    return (
        <>
            <Button className="mb-3" icon={<Download className="size-4" />} href={adminPlatform.auditCsvUrl()}>
                导出 CSV
            </Button>
            <Table
                rowKey="id"
                dataSource={rows}
                scroll={{ x: 1000 }}
                columns={[
                    { title: "时间", dataIndex: "createdAt" },
                    { title: "Actor", dataIndex: "actorId" },
                    { title: "Action", dataIndex: "action" },
                    { title: "Resource", render: (_, x) => `${x.resourceType}:${x.resourceId}` },
                    { title: "requestId", dataIndex: "requestId" },
                ]}
            />
        </>
    );
}
