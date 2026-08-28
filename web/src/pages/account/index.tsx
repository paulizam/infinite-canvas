import { Alert, Button, Card, Form, Input, Select, Tabs, Typography, message } from "antd";
import { Cloud, HardDrive } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useCloudSessionStore } from "@/stores/use-cloud-session-store";
import { useCloudCanvasSyncStore } from "@/stores/use-cloud-canvas-sync-store";

type LoginFields = { email: string; password: string };
type RegisterFields = LoginFields & { name: string };

export default function AccountPage() {
    const { t } = useTranslation();
    const session = useCloudSessionStore();
    const sync = useCloudCanvasSyncStore();
    const busy = session.status === "loading";

    if (session.status === "local") {
        return (
            <PageShell>
                <Card className="max-w-xl">
                    <div className="flex items-start gap-3">
                        <HardDrive className="mt-1 size-5" />
                        <div>
                            <Typography.Title level={4}>{t("account.localTitle")}</Typography.Title>
                            <Typography.Paragraph type="secondary">{t("account.localDescription")}</Typography.Paragraph>
                            <code>VITE_PLATFORM_MODE=server</code>
                        </div>
                    </div>
                </Card>
            </PageShell>
        );
    }

    if (session.status === "authenticated" && session.user) {
        return (
            <PageShell>
                <Card className="max-w-xl" title={session.user.name} extra={<Cloud className="size-5" />}>
                    {sync.state === "conflict" || sync.state === "error" ? (
                        <Alert className="mb-4" type={sync.state === "conflict" ? "warning" : "error"} showIcon message={t(sync.state === "conflict" ? "account.syncConflict" : "account.syncError")} description={sync.message} />
                    ) : null}
                    <Typography.Paragraph type="secondary">{session.user.email}</Typography.Paragraph>
                    <Typography.Text>{t("account.workspace")}</Typography.Text>
                    <Select className="mt-2 w-full" value={session.activeWorkspaceId} options={session.workspaces.map((workspace) => ({ value: workspace.id, label: `${workspace.name} · ${workspace.role}` }))} onChange={session.setActiveWorkspace} />
                    <Button className="mt-5" danger onClick={() => void session.logout()}>
                        {t("account.logout")}
                    </Button>
                    <Link to="/admin">
                        <Button className="mt-5 ml-2">平台管理后台</Button>
                    </Link>
                </Card>
            </PageShell>
        );
    }

    const submitLogin = async (values: LoginFields) => {
        try {
            await session.login(values.email, values.password);
            message.success(t("account.loginSuccess"));
        } catch {
            // The store exposes the sanitized server message below.
        }
    };
    const submitRegister = async (values: RegisterFields) => {
        try {
            await session.register(values);
            message.success(t("account.registerSuccess"));
        } catch {
            // The store exposes the sanitized server message below.
        }
    };
    return (
        <PageShell>
            <Card className="max-w-md">
                {session.error ? <Alert className="mb-4" type="error" showIcon message={session.error} /> : null}
                <Tabs
                    items={[
                        {
                            key: "login",
                            label: t("account.login"),
                            children: (
                                <Form<LoginFields> layout="vertical" onFinish={(values) => void submitLogin(values)}>
                                    <Form.Item name="email" label={t("account.email")} rules={[{ required: true, type: "email" }]}>
                                        <Input autoComplete="email" />
                                    </Form.Item>
                                    <Form.Item name="password" label={t("account.password")} rules={[{ required: true }]}>
                                        <Input.Password autoComplete="current-password" />
                                    </Form.Item>
                                    <Button block type="primary" htmlType="submit" loading={busy}>
                                        {t("account.login")}
                                    </Button>
                                </Form>
                            ),
                        },
                        {
                            key: "register",
                            label: t("account.register"),
                            children: (
                                <Form<RegisterFields> layout="vertical" onFinish={(values) => void submitRegister(values)}>
                                    <Form.Item name="name" label={t("account.name")} rules={[{ required: true }]}>
                                        <Input autoComplete="name" />
                                    </Form.Item>
                                    <Form.Item name="email" label={t("account.email")} rules={[{ required: true, type: "email" }]}>
                                        <Input autoComplete="email" />
                                    </Form.Item>
                                    <Form.Item name="password" label={t("account.password")} rules={[{ required: true, min: 8 }]}>
                                        <Input.Password autoComplete="new-password" />
                                    </Form.Item>
                                    <Button block type="primary" htmlType="submit" loading={busy}>
                                        {t("account.register")}
                                    </Button>
                                </Form>
                            ),
                        },
                    ]}
                />
                <Typography.Paragraph className="mt-2" type="secondary">
                    {t(`account.sync.${sync.state}`)}
                </Typography.Paragraph>
            </Card>
        </PageShell>
    );
}

function PageShell({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-8">
                <h1 className="mb-1 text-xl font-semibold">{t("account.title")}</h1>
                <p className="mb-6 text-sm text-stone-500">{t("account.description")}</p>
                {children}
            </div>
        </main>
    );
}
