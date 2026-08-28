import { Alert, Button, Card, Col, DatePicker, Divider, Form, Input, InputNumber, Radio, Row, Select, Space, Steps, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { adminPlatform, type AdminCommerce, type AdminModelCatalog } from "@/services/admin-platform";

const capabilities = ["text", "image", "video", "audio"] as const;
export function ModelAdmin() {
    const [step, setStep] = useState(0),
        [catalog, setCatalog] = useState<AdminModelCatalog | null>(null),
        [channelId, setChannelId] = useState(() => crypto.randomUUID()),
        [protocolId, setProtocolId] = useState("openai"),
        [protocolAdapter, setProtocolAdapter] = useState("openai-compatible"),
        [discovered, setDiscovered] = useState<Array<{ id: string; displayName?: string }>>([]),
        [selected, setSelected] = useState<string[]>([]),
        [capability, setCapability] = useState<Record<string, (typeof capabilities)[number]>>({}),
        [busy, setBusy] = useState(false),
        [error, setError] = useState<string | null>(null);
    const load = useCallback(async () => {
        try {
            setCatalog(await adminPlatform.models());
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            await load();
            message.success("步骤已完成");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    const discover = () =>
        run(async () => {
            const x = await adminPlatform.discover(channelId);
            setDiscovered(x.models);
            setSelected(x.models.map((m) => m.id));
            setCapability(Object.fromEntries(x.models.map((m) => [m.id, "text"])));
            setStep(3);
        });
    const importModels = () =>
        run(async () => {
            for (const id of selected) {
                await adminPlatform.saveUpstream(crypto.randomUUID(), { channelId, modelId: id, capability: capability[id] || "text", enabled: true, healthState: "healthy", cooldownUntil: null, config: {} });
            }
            setStep(4);
        });
    return (
        <div>
            <Steps current={step} items={["协议", "渠道与凭据", "连接测试", "模型同步", "逻辑模型"].map((title) => ({ title }))} />
            {error ? <Alert className="my-4" type="error" showIcon message={error} /> : null}
            <Divider />
            {step === 0 ? (
                <Card title="1. 选择并保存协议">
                    <Form
                        layout="vertical"
                        initialValues={{ id: "openai", name: "OpenAI Compatible", adapter: "openai-compatible" }}
                        onFinish={(x) =>
                            void run(async () => {
                                await adminPlatform.saveProtocol(x.id, { name: x.name, adapter: x.adapter, enabled: true, config: x.adapter === "custom" ? { modelCatalogPath: "/v1/models" } : {} });
                                setProtocolId(x.id);
                                setProtocolAdapter(x.adapter);
                                setStep(1);
                            })
                        }
                    >
                        <Form.Item name="id" label="协议 ID" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="adapter" label="Adapter">
                            <Radio.Group options={["openai-compatible", "gemini", "seedance", "stable-diffusion", "media-kit", "volcengine", "custom"].map((value) => ({ value, label: value }))} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={busy}>
                            保存并下一步
                        </Button>
                    </Form>
                </Card>
            ) : null}
            {step === 1 ? (
                <Card title="2. 配置渠道（Secret 保存后不回显）">
                    <Form
                        layout="vertical"
                        initialValues={{ name: "Primary Channel", baseUrl: "https://api.example.com/v1", apiKey: "" }}
                        onFinish={(x) =>
                            void run(async () => {
                                await adminPlatform.saveChannel(channelId, {
                                    name: x.name,
                                    protocolId,
                                    baseUrl: x.baseUrl,
                                    enabled: true,
                                    config: protocolAdapter === "volcengine" ? { accessKeyId: x.accessKeyId, region: x.region || "cn-north-1", service: x.service || "ark" } : {},
                                    apiKey: x.apiKey,
                                });
                                setStep(2);
                            })
                        }
                    >
                        <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, type: "url" }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="apiKey" label={protocolAdapter === "volcengine" ? "Secret Access Key (SK)" : "API Key"} rules={[{ required: true }]}>
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        {protocolAdapter === "volcengine" ? (
                            <>
                                <Form.Item name="accessKeyId" label="Access Key ID (AK)" rules={[{ required: true }]}>
                                    <Input autoComplete="off" />
                                </Form.Item>
                                <Form.Item name="region" label="Region" initialValue="cn-north-1">
                                    <Input />
                                </Form.Item>
                                <Form.Item name="service" label="Service" initialValue="ark">
                                    <Input />
                                </Form.Item>
                                <Alert className="mb-4" type="info" showIcon message="AK 作为非秘密标识保存在渠道 config；SK 加密保存且不回显。" />
                            </>
                        ) : null}
                        <Button type="primary" htmlType="submit" loading={busy}>
                            保存并下一步
                        </Button>
                    </Form>
                </Card>
            ) : null}
            {step === 2 ? (
                <Card title="3. 连接测试">
                    <Space>
                        <Button
                            loading={busy}
                            onClick={() =>
                                void run(async () => {
                                    const x = await adminPlatform.testChannel(channelId);
                                    message.success(`连接成功：${x.latencyMs}ms，${x.modelCount} 个模型`);
                                })
                            }
                        >
                            测试连接
                        </Button>
                        <Button type="primary" loading={busy} onClick={() => void discover()}>
                            测试并拉取模型
                        </Button>
                        {protocolAdapter === "volcengine"
                            ? (["models", "resources", "usage"] as const).map((kind) => (
                                  <Button
                                      key={kind}
                                      loading={busy}
                                      onClick={() =>
                                          void run(async () => {
                                              const result = await adminPlatform.volcengine(channelId, kind);
                                              const summary = result.resourceUsage?.map((item) => `${item.configurationCode}: ${item.remaining}/${item.quota} ${item.unit}`).join("；");
                                              message.success(summary || `${kind} 查询成功：${JSON.stringify(result.payload).slice(0, 120)}`);
                                          })
                                      }
                                  >
                                      {kind}
                                  </Button>
                              ))
                            : null}
                    </Space>
                </Card>
            ) : null}
            {step === 3 ? (
                <Card title="4. 同步上游模型">
                    <Table
                        rowKey="id"
                        dataSource={discovered}
                        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }}
                        columns={[
                            { title: "Model ID", dataIndex: "id" },
                            { title: "显示名", dataIndex: "displayName" },
                            { title: "能力", render: (_, x) => <Select value={capability[x.id]} options={capabilities.map((value) => ({ value, label: value }))} onChange={(v) => setCapability((s) => ({ ...s, [x.id]: v }))} /> },
                        ]}
                        pagination={{ pageSize: 20 }}
                    />
                    <Button type="primary" disabled={!selected.length} loading={busy} onClick={() => void importModels()}>
                        导入 {selected.length} 个模型
                    </Button>
                </Card>
            ) : null}
            {step === 4 ? (
                <Card title="5. 建立逻辑模型与路由绑定">
                    <Form
                        layout="vertical"
                        initialValues={{ id: "default-text", name: "Default Text", capability: "text", upstreamModelId: catalog?.upstreamModels.at(-1)?.id, priority: 0, weight: 100, isDefault: true }}
                        onFinish={(x) =>
                            void run(async () => {
                                await adminPlatform.saveLogical(x.id, { name: x.name, capability: x.capability, enabled: true, isDefault: x.isDefault });
                                await adminPlatform.saveBinding(crypto.randomUUID(), { logicalModelId: x.id, upstreamModelId: x.upstreamModelId, enabled: true, priority: x.priority, weight: x.weight, capabilityProfile: {} });
                                message.success("五步模型渠道配置完成");
                            })
                        }
                    >
                        <Form.Item name="id" label="逻辑模型 ID" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="capability" label="能力">
                            <Select options={capabilities.map((value) => ({ value, label: value }))} />
                        </Form.Item>
                        <Form.Item name="upstreamModelId" label="上游模型" rules={[{ required: true }]}>
                            <Select showSearch options={(catalog?.upstreamModels || []).map((x) => ({ value: x.id, label: `${x.modelId} · ${x.capability}` }))} />
                        </Form.Item>
                        <Form.Item name="priority" label="优先级">
                            <InputNumber min={0} />
                        </Form.Item>
                        <Form.Item name="weight" label="权重">
                            <InputNumber min={1} max={10000} />
                        </Form.Item>
                        <Form.Item name="isDefault" label="设为默认" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={busy}>
                            启用逻辑模型
                        </Button>
                    </Form>
                </Card>
            ) : null}
            <Divider />
            <Card title="当前模型目录">
                <Row gutter={16}>
                    {[
                        ["协议", catalog?.protocols.length],
                        ["渠道", catalog?.channels.length],
                        ["上游模型", catalog?.upstreamModels.length],
                        ["逻辑模型", catalog?.logicalModels.length],
                        ["绑定", catalog?.bindings.length],
                    ].map(([k, v]) => (
                        <Col key={String(k)}>
                            <Tag>
                                {k}: {v || 0}
                            </Tag>
                        </Col>
                    ))}
                </Row>
            </Card>
        </div>
    );
}

export function CommerceAdmin() {
    const [catalog, setCatalog] = useState<AdminCommerce | null>(null),
        [orders, setOrders] = useState<Array<Record<string, unknown>>>([]),
        [refunds, setRefunds] = useState<Array<Record<string, unknown>>>([]),
        [code, setCode] = useState<string | null>(null),
        [error, setError] = useState<string | null>(null),
        [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        try {
            const [c, o, r] = await Promise.all([adminPlatform.commerce(), adminPlatform.orders(), adminPlatform.refunds()]);
            setCatalog(c);
            setOrders(o);
            setRefunds(r);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        try {
            await fn();
            await load();
            message.success("操作已完成");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    const defaults = { startsAt: dayjs(), endsAt: dayjs().add(30, "day"), active: true };
    return (
        <div>
            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
            <Tabs
                items={[
                    {
                        key: "products",
                        label: `套餐 (${catalog?.products.length || 0})`,
                        children: (
                            <Row gutter={16}>
                                <Col xs={24} lg={8}>
                                    <Card title="新增/更新套餐">
                                        <Form
                                            layout="vertical"
                                            initialValues={{ currency: "CNY", active: true, units: 1000, priceMinor: 990 }}
                                            onFinish={(x) =>
                                                void run(async () => {
                                                    await adminPlatform.saveProduct(x);
                                                })
                                            }
                                        >
                                            <Form.Item name="code" label="Code" rules={[{ required: true }]}>
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="units" label="积分">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Form.Item name="priceMinor" label="价格（分）">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Form.Item name="currency" label="币种">
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="active" label="启用" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Button type="primary" htmlType="submit" loading={busy}>
                                                保存
                                            </Button>
                                        </Form>
                                    </Card>
                                </Col>
                                <Col xs={24} lg={16}>
                                    <Table dataSource={catalog?.products || []} rowKey={(x) => String(x.id)} columns={simpleColumns(["code", "name", "units", "priceMinor", "effectivePriceMinor", "active"])} />
                                </Col>
                            </Row>
                        ),
                    },
                    {
                        key: "promotions",
                        label: `促销 (${catalog?.promotions.length || 0})`,
                        children: (
                            <Row gutter={16}>
                                <Col xs={24} lg={8}>
                                    <Card title="创建促销">
                                        <Form
                                            layout="vertical"
                                            initialValues={{ ...defaults, discountBps: 1000, bonusUnits: 0 }}
                                            onFinish={(x) =>
                                                void run(async () => {
                                                    await adminPlatform.savePromotion({ ...x, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() });
                                                })
                                            }
                                        >
                                            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="discountBps" label="折扣 BPS">
                                                <InputNumber min={0} max={10000} />
                                            </Form.Item>
                                            <Form.Item name="bonusUnits" label="赠送积分">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Form.Item name="startsAt" label="开始">
                                                <DatePicker showTime />
                                            </Form.Item>
                                            <Form.Item name="endsAt" label="结束">
                                                <DatePicker showTime />
                                            </Form.Item>
                                            <Form.Item name="active" label="启用" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Button type="primary" htmlType="submit">
                                                保存
                                            </Button>
                                        </Form>
                                    </Card>
                                </Col>
                                <Col xs={24} lg={16}>
                                    <Table dataSource={catalog?.promotions || []} rowKey={(x) => String(x.id)} columns={simpleColumns(["name", "discountBps", "bonusUnits", "startsAt", "endsAt", "active"])} />
                                </Col>
                            </Row>
                        ),
                    },
                    {
                        key: "codes",
                        label: `优惠券 / CDK (${catalog?.codes.length || 0})`,
                        children: (
                            <Row gutter={16}>
                                <Col xs={24} lg={8}>
                                    <Card title="生成兑换码（明文只显示一次）">
                                        {code ? <Alert className="mb-3" type="success" message={<Typography.Text copyable>{code}</Typography.Text>} /> : null}
                                        <Form
                                            layout="vertical"
                                            initialValues={{ ...defaults, kind: "cdk", discountBps: 0, bonusUnits: 100, maxRedemptions: 1, perUserLimit: 1 }}
                                            onFinish={(x) =>
                                                void run(async () => {
                                                    const y = await adminPlatform.createCode({ ...x, startsAt: x.startsAt.toISOString(), expiresAt: x.endsAt.toISOString() });
                                                    setCode(String(y.code));
                                                })
                                            }
                                        >
                                            <Form.Item name="kind" label="类型">
                                                <Select options={["coupon", "cdk"].map((value) => ({ value, label: value }))} />
                                            </Form.Item>
                                            <Form.Item name="label" label="标签" rules={[{ required: true }]}>
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="discountBps" label="折扣 BPS">
                                                <InputNumber min={0} max={10000} />
                                            </Form.Item>
                                            <Form.Item name="bonusUnits" label="奖励积分">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Form.Item name="maxRedemptions" label="总领取次数">
                                                <InputNumber min={1} />
                                            </Form.Item>
                                            <Form.Item name="perUserLimit" label="每人上限">
                                                <InputNumber min={1} />
                                            </Form.Item>
                                            <Form.Item name="startsAt" label="开始">
                                                <DatePicker showTime />
                                            </Form.Item>
                                            <Form.Item name="endsAt" label="过期">
                                                <DatePicker showTime />
                                            </Form.Item>
                                            <Form.Item name="active" label="启用" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Button type="primary" htmlType="submit">
                                                生成
                                            </Button>
                                        </Form>
                                    </Card>
                                </Col>
                                <Col xs={24} lg={16}>
                                    <Table dataSource={catalog?.codes || []} rowKey={(x) => String(x.id)} columns={simpleColumns(["kind", "label", "discountBps", "bonusUnits", "redeemedCount", "maxRedemptions", "expiresAt", "active"])} />
                                </Col>
                            </Row>
                        ),
                    },
                    {
                        key: "orders",
                        label: `订单 / 退款 (${orders.length}/${refunds.length})`,
                        children: (
                            <>
                                <Card title="订单">
                                    <Table
                                        dataSource={orders}
                                        rowKey={(x) => String(x.id)}
                                        scroll={{ x: 1000 }}
                                        columns={[
                                            ...simpleColumns(["id", "userId", "status", "units", "amountMinor", "currency", "provider", "createdAt"]),
                                            {
                                                title: "操作",
                                                render: (_, x) => (
                                                    <Button
                                                        size="small"
                                                        disabled={x.status !== "fulfilled"}
                                                        onClick={() =>
                                                            void run(async () => {
                                                                await adminPlatform.createRefund({ userId: x.userId, orderId: x.id, idempotencyKey: `admin-${crypto.randomUUID()}`, reason: "admin approved refund" });
                                                            })
                                                        }
                                                    >
                                                        退款
                                                    </Button>
                                                ),
                                            },
                                        ]}
                                    />
                                </Card>
                                <Card className="mt-4" title="退款">
                                    <Table dataSource={refunds} rowKey={(x) => String(x.id)} columns={simpleColumns(["id", "orderId", "status", "amountMinor", "units", "errorCode", "createdAt"])} />
                                </Card>
                            </>
                        ),
                    },
                    { key: "finance", label: "对账与财务", children: <Finance /> },
                ]}
            />
        </div>
    );
}
function Finance() {
    const [report, setReport] = useState<Record<string, number> | null>(null);
    const range = [dayjs().subtract(30, "day"), dayjs()] as const;
    return (
        <Row gutter={16}>
            <Col xs={24} lg={10}>
                <Card title="财务统计">
                    <Button onClick={() => void adminPlatform.report(range[0].toISOString(), range[1].toISOString()).then(setReport)}>统计最近 30 天</Button>
                    {report ? <pre className="mt-3 overflow-auto">{JSON.stringify(report, null, 2)}</pre> : null}
                </Card>
            </Col>
            <Col xs={24} lg={14}>
                <Card title="渠道账单对账">
                    <Form
                        layout="vertical"
                        initialValues={{ date: dayjs(), lines: "[]" }}
                        onFinish={async (x) => {
                            try {
                                const lines = JSON.parse(x.lines) as unknown;
                                if (!Array.isArray(lines)) throw new Error("账单 JSON 必须是数组");
                                await adminPlatform.reconcile({ date: x.date.format("YYYY-MM-DD"), lines });
                                message.success("对账完成");
                            } catch (e) {
                                message.error(e instanceof Error ? e.message : String(e));
                            }
                        }}
                    >
                        <Form.Item name="date" label="账单日期">
                            <DatePicker />
                        </Form.Item>
                        <Form.Item name="lines" label='账单 JSON：[{"providerTransactionId":"...","amountMinor":100}]'>
                            <Input.TextArea rows={8} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit">
                            执行对账
                        </Button>
                    </Form>
                </Card>
            </Col>
        </Row>
    );
}
const simpleColumns = (keys: string[]) => keys.map((key) => ({ title: key, dataIndex: key, ellipsis: true, render: (x: unknown) => (typeof x === "boolean" ? <Tag color={x ? "green" : "default"}>{String(x)}</Tag> : String(x ?? "-")) }));
