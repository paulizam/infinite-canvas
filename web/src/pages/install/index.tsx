import { Alert, Button, Card, Form, Input, Typography, message } from "antd";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cloudPlatform } from "@/services/cloud-platform";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";

type Fields = { token: string; name: string; email: string; password: string; confirm: string };

export default function InstallPage() {
    const { i18n } = useTranslation();
    const zh = i18n.language.startsWith("zh");
    const navigate = useNavigate();
    const initialize = useCloudSessionStore((state) => state.initialize);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async ({ confirm: _, ...input }: Fields) => {
        setBusy(true);
        setError(null);
        try {
            await cloudPlatform.install(input);
            await initialize();
            message.success(zh ? "安装完成" : "Installation complete");
            navigate("/account", { replace: true });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    };
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex min-h-full max-w-xl items-center px-6 py-10">
                <Card
                    className="w-full"
                    title={
                        <span className="flex items-center gap-2">
                            <ShieldCheck className="size-5" />
                            {zh ? "初始化 Infinite Canvas" : "Initialize Infinite Canvas"}
                        </span>
                    }
                >
                    <Typography.Paragraph type="secondary">
                        {zh
                            ? "使用部署时配置的一次性安装 Token 创建首个平台管理员。Token 成功使用后将永久失效。"
                            : "Use the one-time installation token configured during deployment to create the first platform administrator. It is permanently consumed after success."}
                    </Typography.Paragraph>
                    {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
                    <Form<Fields> layout="vertical" onFinish={(values) => void submit(values)}>
                        <Form.Item name="token" label={zh ? "安装 Token" : "Installation token"} rules={[{ required: true }, { min: 32 }]}>
                            <Input.Password autoComplete="one-time-code" />
                        </Form.Item>
                        <Form.Item name="name" label={zh ? "管理员名称" : "Administrator name"} rules={[{ required: true, max: 80 }]}>
                            <Input autoComplete="name" />
                        </Form.Item>
                        <Form.Item name="email" label={zh ? "管理员邮箱" : "Administrator email"} rules={[{ required: true, type: "email" }]}>
                            <Input autoComplete="email" />
                        </Form.Item>
                        <Form.Item name="password" label={zh ? "密码" : "Password"} rules={[{ required: true, min: 8, max: 128 }]}>
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item
                            name="confirm"
                            label={zh ? "确认密码" : "Confirm password"}
                            dependencies={["password"]}
                            rules={[
                                { required: true },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error(zh ? "两次密码不一致" : "Passwords do not match"));
                                    },
                                }),
                            ]}
                        >
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Button block type="primary" htmlType="submit" loading={busy}>
                            {zh ? "创建首个管理员" : "Create first administrator"}
                        </Button>
                    </Form>
                </Card>
            </div>
        </main>
    );
}
