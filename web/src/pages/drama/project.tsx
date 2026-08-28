import { ArrowLeft, Download, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, InputNumber, List, Modal, Progress, Select, Space, Spin, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { Link, useParams } from "react-router-dom";
import type { GenerationJob } from "@infinite-canvas/contracts";

import {
    cloudPlatform,
    type CloudDramaDetail,
    type CloudDramaProductionState,
    type CloudDramaRenderJob,
    type CloudDramaRenderState,
} from "@/services/cloud-platform";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";

type Action = "project" | "script" | "analysis" | "entity" | "shot" | "generation" | "selection" | "timeline" | "review" | "render" | "interop" | null;
const mutation = (revision: number) => ({ expectedRevision: revision, mutationId: crypto.randomUUID() });

export default function DramaProjectPage() {
    const { id = "" } = useParams();
    const session = useCloudSessionStore();
    const { message } = App.useApp();
    const [form] = Form.useForm<Record<string, unknown>>();
    const [detail, setDetail] = useState<CloudDramaDetail | null>(null);
    const [production, setProduction] = useState<CloudDramaProductionState>({ generations: [], timeline: [], reviews: [] });
    const [renders, setRenders] = useState<CloudDramaRenderState>({ jobs: [], versions: [] });
    const [generationCosts, setGenerationCosts] = useState({ estimated: 0, actual: 0 });
    const [analyses, setAnalyses] = useState<GenerationJob[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [action, setAction] = useState<Action>(null);

    const load = useCallback(async () => {
        if (!id || session.status !== "authenticated") return;
        setLoading(true);
        setError("");
        try {
            const [nextDetail, nextProduction, nextRenders, nextAnalyses] = await Promise.all([
                cloudPlatform.getDramaProject(id),
                cloudPlatform.getDramaProduction(id),
                cloudPlatform.listDramaRenders(id),
                cloudPlatform.listDramaScriptAnalyses(id),
            ]);
            setDetail(nextDetail);
            setProduction(nextProduction);
            setRenders(nextRenders);
            setAnalyses(nextAnalyses);
            const jobs = await cloudPlatform.listGenerationJobs(nextDetail.project.workspaceId);
            const ids = new Set(nextProduction.generations.map((item) => item.generationJobId));
            const linked = jobs.filter((job) => ids.has(job.id));
            setGenerationCosts({
                estimated: linked.reduce((sum, job) => sum + job.billing.estimatedUnits, 0),
                actual: linked.reduce((sum, job) => sum + (job.billing.actualUnits ?? job.billing.reservedUnits), 0),
            });
        } catch (value) {
            setError(errorMessage(value));
        } finally {
            setLoading(false);
        }
    }, [id, session.status]);
    useEffect(() => void load(), [load]);

    const open = (next: Exclude<Action, null>) => {
        setAction(next);
        form.resetFields();
        if (next === "project" && detail) form.setFieldsValue({ title: detail.project.title, sourceText: detail.project.sourceText, sourceAssetId: detail.project.sourceAssetId });
        if (next === "script" && detail) form.setFieldsValue({ content: detail.scripts[0]?.content || detail.project.sourceText, reviewStatus: "draft", operation: "revision", segments: "[]", analysis: "{}" });
        if (next === "analysis" && detail) form.setFieldsValue({ scriptVersionId: detail.scripts[0]?.id });
        if (next === "entity") form.setFieldsValue({ kind: "character", sortOrder: detail?.entities.length || 0 });
        if (next === "shot") form.setFieldsValue({ durationMs: 3000, sortOrder: detail?.shots.length || 0 });
        if (next === "generation") form.setFieldsValue({ capability: "image", parameters: "{}" });
        if (next === "timeline") form.setFieldsValue({ kind: "dialogue", startMs: 0, endMs: 3000, sortOrder: production.timeline.length });
        if (next === "review") form.setFieldsValue({ status: "pending" });
        if (next === "render") form.setFieldsValue({ kind: "jianying", settings: '{"fps":30}' });
        if (next === "interop") form.setFieldsValue({ direction: "from-asset", targetKind: "prop", sortOrder: detail?.entities.length || 0, expectedCanvasRevision: 0, x: 0, y: 0 });
    };

    const submit = async () => {
        if (!detail || !action) return;
        const values = await form.validateFields();
        const base = mutation(detail.project.revision);
        setSaving(true);
        try {
            if (action === "project") await cloudPlatform.updateDramaProject(id, { ...base, title: text(values.title), sourceText: text(values.sourceText), sourceAssetId: optional(values.sourceAssetId) });
            if (action === "script") await cloudPlatform.addDramaScriptVersion(id, { ...base, content: text(values.content), reviewStatus: values.reviewStatus as "draft", operation: values.operation as "revision", segments: jsonArray(values.segments), analysis: jsonObject(values.analysis) });
            if (action === "analysis") await cloudPlatform.createDramaScriptAnalysis(id, { ...base, scriptVersionId: text(values.scriptVersionId), logicalModelId: text(values.logicalModelId) });
            if (action === "entity") await cloudPlatform.addDramaEntity(id, { ...base, kind: values.kind as "character", name: text(values.name), description: text(values.description), prompt: text(values.prompt), ...(optional(values.referenceAssetId) ? { referenceAssetId: optional(values.referenceAssetId)! } : {}), sortOrder: number(values.sortOrder) });
            if (action === "shot") await cloudPlatform.addDramaShot(id, { ...base, title: text(values.title), prompt: text(values.prompt), framing: text(values.framing), cameraMovement: text(values.cameraMovement), durationMs: number(values.durationMs), sortOrder: number(values.sortOrder) });
            if (action === "generation") await cloudPlatform.createDramaGeneration(id, { ...base, shotId: text(values.shotId), capability: values.capability as "image", logicalModelId: text(values.logicalModelId), parameters: jsonObject(values.parameters) });
            if (action === "selection") await cloudPlatform.selectDramaGeneration(id, { ...base, generationId: text(values.generationId), assetId: text(values.assetId) });
            if (action === "timeline") await cloudPlatform.addDramaTimelineItem(id, { ...base, ...(optional(values.shotId) ? { shotId: optional(values.shotId)! } : {}), kind: values.kind as "dialogue", textContent: text(values.textContent), voice: text(values.voice), ...(optional(values.assetId) ? { assetId: optional(values.assetId)! } : {}), startMs: number(values.startMs), endMs: number(values.endMs), sortOrder: number(values.sortOrder) });
            if (action === "review") await cloudPlatform.addDramaReview(id, { ...base, shotId: text(values.shotId), status: values.status as "pending", comment: text(values.comment) });
            if (action === "render") await cloudPlatform.createDramaRender(id, { ...base, kind: values.kind as "jianying", settings: jsonObject(values.settings) });
            if (action === "interop") {
                const direction = text(values.direction);
                if (direction === "to-canvas") {
                    await cloudPlatform.sendDramaAssetToCanvas(id, { canvasProjectId: text(values.canvasProjectId), assetId: text(values.assetId), expectedCanvasRevision: number(values.expectedCanvasRevision), mutationId: crypto.randomUUID(), title: text(values.name), position: { x: number(values.x), y: number(values.y) } });
                } else {
                    const target = { type: "entity" as const, kind: values.targetKind as "prop", name: text(values.name), description: text(values.description), prompt: text(values.prompt), sortOrder: number(values.sortOrder) };
                    if (direction === "from-canvas") await cloudPlatform.importDramaFromCanvas(id, { canvasProjectId: text(values.canvasProjectId), nodeId: text(values.nodeId), expectedDramaRevision: detail.project.revision, mutationId: crypto.randomUUID(), target });
                    else await cloudPlatform.importDramaFromAsset(id, { assetId: text(values.assetId), expectedDramaRevision: detail.project.revision, mutationId: crypto.randomUUID(), target });
                }
            }
            setAction(null);
            message.success("操作已提交");
            await load();
        } catch (value) {
            message.error(errorMessage(value));
        } finally {
            setSaving(false);
        }
    };

    const retry = async (job: CloudDramaRenderJob) => {
        try { await cloudPlatform.retryDramaRender(job.id, crypto.randomUUID()); message.success("已创建重试任务"); await load(); } catch (value) { message.error(errorMessage(value)); }
    };
    const download = async (assetId: string, name: string) => {
        try { saveAs(await cloudPlatform.downloadAsset(assetId), name); } catch (value) { message.error(errorMessage(value)); }
    };
    const applyAnalysis = async (jobId: string) => {
        if (!detail) return;
        try { await cloudPlatform.applyDramaScriptAnalysis(id, { ...mutation(detail.project.revision), jobId }); message.success("分析结果已应用为新剧本版本"); await load(); } catch (value) { message.error(errorMessage(value)); }
    };

    if (session.status === "local" || session.status === "guest") return <main className="p-8"><Alert showIcon type="info" message="短剧工作台需要登录 Server Mode" action={<Button href="/account">前往账户</Button>} /></main>;
    if (!detail && loading) return <div className="flex h-full items-center justify-center"><Spin size="large" /></div>;
    if (!detail) return <main className="p-8"><Alert type="error" showIcon message="无法打开短剧项目" description={error || "项目不存在"} /></main>;

    const shotOptions = detail.shots.map((shot) => ({ value: shot.id, label: shot.title }));
    const generationOptions = production.generations.map((item) => ({ value: item.id, label: `${shotName(detail, item.shotId)} · ${item.capability}` }));
    const latestReviews = new Map(production.reviews.map((review) => [review.shotId, review]));
    const approved = detail.shots.filter((shot) => latestReviews.get(shot.id)?.status === "approved").length;

    const items = [
        { key: "script", label: `剧本 (${detail.scripts.length})`, children: <ScriptPanel detail={detail} analyses={analyses} onAdd={() => open("script")} onAnalyze={() => open("analysis")} onApply={applyAnalysis} /> },
        { key: "entities", label: `角色与资产 (${detail.entities.length})`, children: <EntityPanel detail={detail} onAdd={() => open("entity")} /> },
        { key: "shots", label: `分镜 (${detail.shots.length})`, children: <ShotPanel detail={detail} onAdd={() => open("shot")} /> },
        { key: "generation", label: `生成 (${production.generations.length})`, children: <GenerationPanel detail={detail} production={production} costs={generationCosts} onGenerate={() => open("generation")} onSelect={() => open("selection")} /> },
        { key: "timeline", label: `时间轴 (${production.timeline.length})`, children: <TimelinePanel detail={detail} production={production} onAdd={() => open("timeline")} /> },
        { key: "review", label: `审批 (${production.reviews.length})`, children: <ReviewPanel detail={detail} production={production} onAdd={() => open("review")} /> },
        { key: "render", label: `交付 (${renders.jobs.length})`, children: <RenderPanel renders={renders} onCreate={() => open("render")} onRetry={retry} onDownload={download} /> },
        { key: "interop", label: "Canvas / 素材互通", children: <InteropPanel onOpen={() => open("interop")} /> },
    ];
    return (
        <main className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-950">
            <div className="mx-auto max-w-7xl px-6 py-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <Space><Link to="/drama"><Button type="text" icon={<ArrowLeft className="size-4" />}>项目列表</Button></Link><div><Typography.Title level={3} className="!mb-0">{detail.project.title}</Typography.Title><Typography.Text type="secondary">Revision {detail.project.revision}</Typography.Text></div></Space>
                    <Space><Button onClick={() => open("project")}>项目设置</Button><Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>刷新</Button></Space>
                </div>
                {error ? <Alert className="mb-4" type="warning" showIcon message={error} /> : null}
                <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Card size="small"><Statistic title="镜头" value={detail.shots.length} /></Card><Card size="small"><Statistic title="已审批" value={approved} suffix={`/ ${detail.shots.length}`} /></Card><Card size="small"><Statistic title="生成版本" value={production.generations.length} /></Card><Card size="small"><Statistic title="渲染版本" value={renders.versions.length} /></Card></div>
                <Card><Tabs items={items} /></Card>
            </div>
            <Modal title={actionTitle(action)} open={!!action} okText="提交" cancelText="取消" confirmLoading={saving} onOk={() => void submit()} onCancel={() => setAction(null)} destroyOnHidden width={680}>
                <Form form={form} layout="vertical" className="pt-3">{actionFields(action, shotOptions, generationOptions, detail.scripts.map((script) => ({ value: script.id, label: `v${script.version} · ${script.operation}` })))}</Form>
            </Modal>
        </main>
    );
}

function ScriptPanel({ detail, analyses, onAdd, onAnalyze, onApply }: { detail: CloudDramaDetail; analyses: GenerationJob[]; onAdd: () => void; onAnalyze: () => void; onApply: (jobId: string) => void }) { return <><Space><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>新建剧本版本</Button><Button disabled={!detail.scripts.length} onClick={onAnalyze}>发起 AI 分析</Button></Space><List className="mt-4" dataSource={detail.scripts} locale={{ emptyText: "暂无剧本版本" }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space>v{item.version}<Tag>{item.operation}</Tag><Tag color={item.reviewStatus === "approved" ? "green" : "default"}>{item.reviewStatus}</Tag></Space>} description={<Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{item.content}</Typography.Paragraph>} /></List.Item>} /><Typography.Title level={5} className="!mt-6">分析任务</Typography.Title><List dataSource={analyses} locale={{ emptyText: "暂无分析任务" }} renderItem={(job) => <List.Item actions={job.status === "succeeded" ? [<Button key="apply" type="link" onClick={() => void onApply(job.id)}>应用为新版本</Button>] : []}><List.Item.Meta title={<Space><StatusTag value={job.status} />{String(job.input.scriptVersionId)}</Space>} description={`${job.logicalModelId} · ${job.errorMessage || new Date(job.updatedAt).toLocaleString()}`} /></List.Item>} /></>; }
function EntityPanel({ detail, onAdd }: { detail: CloudDramaDetail; onAdd: () => void }) { return <><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>添加角色 / 场景 / 道具</Button><List grid={{ gutter: 12, xs: 1, md: 3 }} className="mt-4" dataSource={detail.entities} locale={{ emptyText: "暂无实体档案" }} renderItem={(item) => <List.Item><Card size="small" title={item.name} extra={<Tag>{item.kind}</Tag>}><Typography.Paragraph ellipsis={{ rows: 2 }}>{item.description || "暂无描述"}</Typography.Paragraph><Typography.Text type="secondary">{item.referenceAssetId ? `参考素材 ${item.referenceAssetId}` : "未绑定参考图"}</Typography.Text></Card></List.Item>} /></>; }
function ShotPanel({ detail, onAdd }: { detail: CloudDramaDetail; onAdd: () => void }) { return <><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>添加镜头</Button><Table className="mt-4" rowKey="id" pagination={false} dataSource={detail.shots} columns={[{ title: "顺序", dataIndex: "sortOrder", width: 70 }, { title: "镜头", dataIndex: "title" }, { title: "Prompt", dataIndex: "prompt", ellipsis: true }, { title: "景别", dataIndex: "framing" }, { title: "运镜", dataIndex: "cameraMovement" }, { title: "时长", dataIndex: "durationMs", render: (v: number) => `${v / 1000}s` }]} /></>; }
function GenerationPanel({ detail, production, costs, onGenerate, onSelect }: { detail: CloudDramaDetail; production: CloudDramaProductionState; costs: { estimated: number; actual: number }; onGenerate: () => void; onSelect: () => void }) { return <><Space><Button type="primary" disabled={!detail.shots.length} onClick={onGenerate}>生成镜头媒体</Button><Button disabled={!production.generations.length} onClick={onSelect}>选择生成版本</Button></Space><Descriptions className="mt-4" bordered size="small" items={[{ key: "estimated", label: "预计成本", children: `${costs.estimated} points` }, { key: "actual", label: "已结算/预留", children: `${costs.actual} points` }]} /><Table className="mt-4" rowKey="id" pagination={false} dataSource={production.generations} columns={[{ title: "镜头", dataIndex: "shotId", render: (id: string) => shotName(detail, id) }, { title: "类型", dataIndex: "capability" }, { title: "Job ID", dataIndex: "generationJobId", ellipsis: true }, { title: "选择", render: (_, item) => item.selected ? <Tag color="green">已选 {item.selectedAssetId}</Tag> : <Tag>未选</Tag> }]} /></>; }
function TimelinePanel({ detail, production, onAdd }: { detail: CloudDramaDetail; production: CloudDramaProductionState; onAdd: () => void }) { return <><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>添加时间轴项目</Button><Table className="mt-4" rowKey="id" pagination={false} dataSource={production.timeline} columns={[{ title: "类型", dataIndex: "kind" }, { title: "镜头", dataIndex: "shotId", render: (id: string | null) => id ? shotName(detail, id) : "全局" }, { title: "内容", dataIndex: "textContent", ellipsis: true }, { title: "音色", dataIndex: "voice" }, { title: "区间", render: (_, x) => `${x.startMs}–${x.endMs} ms` }, { title: "素材", dataIndex: "assetId", ellipsis: true }]} /></>; }
function ReviewPanel({ detail, production, onAdd }: { detail: CloudDramaDetail; production: CloudDramaProductionState; onAdd: () => void }) { return <><Button type="primary" disabled={!detail.shots.length} onClick={onAdd}>提交镜头审批</Button><List className="mt-4" dataSource={production.reviews} locale={{ emptyText: "暂无批注或审批" }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space>{shotName(detail, item.shotId)}<StatusTag value={item.status} /></Space>} description={item.comment || "无批注"} /><Typography.Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Typography.Text></List.Item>} /></>; }
function RenderPanel({ renders, onCreate, onRetry, onDownload }: { renders: CloudDramaRenderState; onCreate: () => void; onRetry: (job: CloudDramaRenderJob) => void; onDownload: (id: string, name: string) => void }) { return <><Button type="primary" onClick={onCreate}>创建 FFmpeg / 剪映任务</Button><List className="mt-4" dataSource={renders.jobs} locale={{ emptyText: "暂无渲染任务" }} renderItem={(job) => <List.Item actions={[...(job.status === "failed" || job.status === "cancelled" ? [<Button key="retry" size="small" icon={<RotateCcw className="size-3" />} onClick={() => void onRetry(job)}>重试</Button>] : []), ...(job.outputAssetId ? [<Button key="download" size="small" icon={<Download className="size-3" />} onClick={() => void onDownload(job.outputAssetId!, `${job.kind}-${job.id}`)}>下载原件</Button>] : [])]}><List.Item.Meta title={<Space><Tag>{job.kind}</Tag><StatusTag value={job.status} />Attempt {job.attempt}</Space>} description={<><Progress percent={job.progress} size="small" /><Typography.Text type={job.errorMessage ? "danger" : "secondary"}>{job.errorMessage || job.id}</Typography.Text></>} /></List.Item>} /><Typography.Title level={5} className="!mt-6">不可变交付版本</Typography.Title><List dataSource={renders.versions} locale={{ emptyText: "暂无成功版本" }} renderItem={(version) => <List.Item actions={[<Button key="download" type="link" onClick={() => void onDownload(version.assetId, `${version.kind}-v${version.version}`)}>下载</Button>]}>{version.kind} v{version.version}</List.Item>} /></>; }
function InteropPanel({ onOpen }: { onOpen: () => void }) { return <div className="max-w-2xl"><Alert className="mb-4" showIcon type="info" message="双向生产资产通道" description="可把短剧已关联素材发送为 Canvas 节点，也可把云素材或绑定素材的 Canvas 节点导入为角色、场景或道具参考。所有写入仍受 workspace ACL、revision 与 mutationId 保护。" /><Button type="primary" onClick={onOpen}>创建互通操作</Button></div>; }

function actionFields(action: Action, shots: Array<{ value: string; label: string }>, generations: Array<{ value: string; label: string }>, scripts: Array<{ value: string; label: string }>) {
    const required = [{ required: true }];
    if (action === "project") return <><Form.Item name="title" label="项目名称" rules={required}><Input /></Form.Item><Form.Item name="sourceText" label="来源文本"><Input.TextArea rows={8} /></Form.Item><Form.Item name="sourceAssetId" label="来源素材 UUID"><Input allowClear /></Form.Item></>;
    if (action === "script") return <><Form.Item name="operation" label="操作" rules={required}><Select options={["revision", "split", "merge", "analysis"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="reviewStatus" label="审核状态" rules={required}><Select options={["draft", "reviewing", "approved", "rejected"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="content" label="剧本内容" rules={required}><Input.TextArea rows={10} /></Form.Item><Form.Item name="segments" label="分段 JSON array"><Input.TextArea rows={3} /></Form.Item><Form.Item name="analysis" label="分析 JSON object"><Input.TextArea rows={3} /></Form.Item></>;
    if (action === "analysis") return <><Alert className="mb-4" type="info" showIcon message="分析由统一 Generation Worker 执行并计费；成功结果需人工点击应用，不会覆盖现有版本。" /><Form.Item name="scriptVersionId" label="来源剧本版本" rules={required}><Select options={scripts} /></Form.Item><Form.Item name="logicalModelId" label="Text Logical Model ID" rules={required}><Input placeholder="text/default" /></Form.Item></>;
    if (action === "entity") return <><Form.Item name="kind" label="类型" rules={required}><Select options={[{ value: "character", label: "角色" }, { value: "scene", label: "场景" }, { value: "prop", label: "道具" }]} /></Form.Item><Form.Item name="name" label="名称" rules={required}><Input /></Form.Item><Form.Item name="description" label="描述"><Input.TextArea /></Form.Item><Form.Item name="prompt" label="Prompt"><Input.TextArea /></Form.Item><Form.Item name="referenceAssetId" label="参考素材 UUID"><Input /></Form.Item><Form.Item name="sortOrder" label="顺序" rules={required}><InputNumber min={0} /></Form.Item></>;
    if (action === "shot") return <><Form.Item name="title" label="镜头标题" rules={required}><Input /></Form.Item><Form.Item name="prompt" label="Prompt"><Input.TextArea /></Form.Item><Form.Item name="framing" label="景别"><Input /></Form.Item><Form.Item name="cameraMovement" label="运镜"><Input /></Form.Item><Form.Item name="durationMs" label="时长 (ms)" rules={required}><InputNumber min={100} /></Form.Item><Form.Item name="sortOrder" label="顺序" rules={required}><InputNumber min={0} /></Form.Item></>;
    if (action === "generation") return <><Form.Item name="shotId" label="镜头" rules={required}><Select options={shots} /></Form.Item><Form.Item name="capability" label="生成类型" rules={required}><Select options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} /></Form.Item><Form.Item name="logicalModelId" label="Logical Model ID" rules={required}><Input placeholder="image/default" /></Form.Item><Form.Item name="parameters" label="参数 JSON object" rules={required}><Input.TextArea rows={5} /></Form.Item></>;
    if (action === "selection") return <><Form.Item name="generationId" label="生成版本" rules={required}><Select options={generations} /></Form.Item><Form.Item name="assetId" label="生成结果素材 UUID" rules={required}><Input /></Form.Item></>;
    if (action === "timeline") return <><Form.Item name="kind" label="类型" rules={required}><Select options={["dialogue", "voice", "bgm", "subtitle"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="shotId" label="关联镜头"><Select allowClear options={shots} /></Form.Item><Form.Item name="textContent" label="对白 / 字幕"><Input.TextArea /></Form.Item><Form.Item name="voice" label="音色"><Input /></Form.Item><Form.Item name="assetId" label="音频素材 UUID"><Input /></Form.Item><Space><Form.Item name="startMs" label="开始 ms" rules={required}><InputNumber min={0} /></Form.Item><Form.Item name="endMs" label="结束 ms" rules={required}><InputNumber min={1} /></Form.Item><Form.Item name="sortOrder" label="顺序" rules={required}><InputNumber min={0} /></Form.Item></Space></>;
    if (action === "review") return <><Form.Item name="shotId" label="镜头" rules={required}><Select options={shots} /></Form.Item><Form.Item name="status" label="结论" rules={required}><Select options={[{ value: "pending", label: "待审批" }, { value: "approved", label: "通过" }, { value: "changes_requested", label: "要求修改" }]} /></Form.Item><Form.Item name="comment" label="团队批注"><Input.TextArea rows={5} /></Form.Item></>;
    if (action === "render") return <><Alert className="mb-4" type="info" showIcon message="FFmpeg 需要至少一个已选择媒体；剪映可导出当前时间轴草稿。" /><Form.Item name="kind" label="交付类型" rules={required}><Select options={[{ value: "ffmpeg", label: "FFmpeg 成片" }, { value: "jianying", label: "剪映草稿 ZIP" }]} /></Form.Item><Form.Item name="settings" label="渲染参数 JSON object" rules={required}><Input.TextArea rows={6} /></Form.Item></>;
    if (action === "interop") return <><Form.Item name="direction" label="方向" rules={required}><Select options={[{ value: "from-asset", label: "云素材 → 短剧实体" }, { value: "from-canvas", label: "Canvas 节点 → 短剧实体" }, { value: "to-canvas", label: "短剧素材 → Canvas 节点" }]} /></Form.Item><Form.Item name="assetId" label="云素材 UUID（素材导入或发送 Canvas 时填写）"><Input /></Form.Item><Form.Item name="canvasProjectId" label="Canvas Project ID（Canvas 方向填写）"><Input /></Form.Item><Form.Item name="nodeId" label="Canvas Node ID（从 Canvas 导入时填写）"><Input /></Form.Item><Form.Item name="expectedCanvasRevision" label="Canvas 当前 Revision（发送 Canvas 时填写）"><InputNumber min={0} /></Form.Item><Form.Item name="targetKind" label="导入实体类型"><Select options={[{ value: "character", label: "角色" }, { value: "scene", label: "场景" }, { value: "prop", label: "道具" }]} /></Form.Item><Form.Item name="name" label="实体 / 节点标题"><Input /></Form.Item><Form.Item name="description" label="实体描述"><Input.TextArea /></Form.Item><Form.Item name="prompt" label="实体 Prompt"><Input.TextArea /></Form.Item><Space><Form.Item name="sortOrder" label="实体顺序"><InputNumber min={0} /></Form.Item><Form.Item name="x" label="Canvas X"><InputNumber /></Form.Item><Form.Item name="y" label="Canvas Y"><InputNumber /></Form.Item></Space></>;
    return null;
}
function actionTitle(action: Action) { return ({ project: "项目设置", script: "新建剧本版本", analysis: "发起剧本 AI 分析", entity: "添加实体档案", shot: "添加镜头", generation: "生成镜头媒体", selection: "选择生成版本", timeline: "添加时间轴项目", review: "镜头审批与批注", render: "创建交付任务", interop: "Canvas / 素材互通" } as Record<string, string>)[action || ""] || ""; }
function StatusTag({ value }: { value: string }) { const color = value === "succeeded" || value === "approved" ? "green" : value === "failed" || value === "changes_requested" ? "red" : value === "running" ? "blue" : "default"; return <Tag color={color}>{value}</Tag>; }
function shotName(detail: CloudDramaDetail, id: string) { return detail.shots.find((shot) => shot.id === id)?.title || id; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function optional(value: unknown) { const result = text(value); return result || null; }
function number(value: unknown) { return Number(value); }
function jsonObject(value: unknown) { const parsed = JSON.parse(text(value) || "{}"); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("请输入 JSON object"); return parsed as Record<string, unknown>; }
function jsonArray(value: unknown) { const parsed = JSON.parse(text(value) || "[]"); if (!Array.isArray(parsed)) throw new Error("请输入 JSON array"); return parsed; }
function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
