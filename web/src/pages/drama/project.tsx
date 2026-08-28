import { ArrowLeft, Download, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, InputNumber, List, Modal, Progress, Select, Space, Spin, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { Link, useParams } from "react-router-dom";
import type { GenerationJob } from "@infinite-canvas/contracts";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import {
    cloudPlatform,
    type CloudDramaDetail,
    type CloudDramaProductionState,
    type CloudDramaRenderJob,
    type CloudDramaRenderState,
} from "@/services/cloud-platform";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";
import { buildDramaRenderSettings } from "./render-settings";

type Action = "project" | "script" | "analysis" | "entity" | "shot" | "generation" | "selection" | "timeline" | "review" | "render" | "interop" | null;
const mutation = (revision: number) => ({ expectedRevision: revision, mutationId: crypto.randomUUID() });

export default function DramaProjectPage() {
    useTranslation();
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
        if (next === "render") form.setFieldsValue({ kind: "jianying", jianyingVersion: "6", width: 1080, height: 1920, fps: 30, draftPath: "", settings: "{}" });
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
            if (action === "render") await cloudPlatform.createDramaRender(id, { ...base, kind: values.kind as "jianying", settings: buildDramaRenderSettings(values.kind, values, jsonObject(values.settings)) });
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
            message.success(tr("submitted"));
            await load();
        } catch (value) {
            message.error(errorMessage(value));
        } finally {
            setSaving(false);
        }
    };

    const retry = async (job: CloudDramaRenderJob) => {
        try { await cloudPlatform.retryDramaRender(job.id, crypto.randomUUID()); message.success(tr("retryCreated")); await load(); } catch (value) { message.error(errorMessage(value)); }
    };
    const download = async (assetId: string, name: string) => {
        try { saveAs(await cloudPlatform.downloadAsset(assetId), name); } catch (value) { message.error(errorMessage(value)); }
    };
    const applyAnalysis = async (jobId: string) => {
        if (!detail) return;
        try { await cloudPlatform.applyDramaScriptAnalysis(id, { ...mutation(detail.project.revision), jobId }); message.success(tr("analysisApplied")); await load(); } catch (value) { message.error(errorMessage(value)); }
    };

    if (session.status === "local" || session.status === "guest") return <main className="p-8"><Alert showIcon type="info" message={tr("studioLoginRequired")} action={<Button href="/account">{tr("goAccount")}</Button>} /></main>;
    if (!detail && loading) return <div className="flex h-full items-center justify-center"><Spin size="large" /></div>;
    if (!detail) return <main className="p-8"><Alert type="error" showIcon message={tr("openFailed")} description={error || tr("missing")} /></main>;

    const shotOptions = detail.shots.map((shot) => ({ value: shot.id, label: shot.title }));
    const generationOptions = production.generations.map((item) => ({ value: item.id, label: `${shotName(detail, item.shotId)} · ${item.capability}` }));
    const latestReviews = new Map(production.reviews.map((review) => [review.shotId, review]));
    const approved = detail.shots.filter((shot) => latestReviews.get(shot.id)?.status === "approved").length;

    const items = [
        { key: "script", label: tr("tabsScript", { count: detail.scripts.length }), children: <ScriptPanel detail={detail} analyses={analyses} onAdd={() => open("script")} onAnalyze={() => open("analysis")} onApply={applyAnalysis} /> },
        { key: "entities", label: tr("tabsEntities", { count: detail.entities.length }), children: <EntityPanel detail={detail} onAdd={() => open("entity")} /> },
        { key: "shots", label: tr("tabsShots", { count: detail.shots.length }), children: <ShotPanel detail={detail} onAdd={() => open("shot")} /> },
        { key: "generation", label: tr("tabsGeneration", { count: production.generations.length }), children: <GenerationPanel detail={detail} production={production} costs={generationCosts} onGenerate={() => open("generation")} onSelect={() => open("selection")} /> },
        { key: "timeline", label: tr("tabsTimeline", { count: production.timeline.length }), children: <TimelinePanel detail={detail} production={production} onAdd={() => open("timeline")} /> },
        { key: "review", label: tr("tabsReview", { count: production.reviews.length }), children: <ReviewPanel detail={detail} production={production} onAdd={() => open("review")} /> },
        { key: "render", label: tr("tabsDelivery", { count: renders.jobs.length }), children: <RenderPanel renders={renders} onCreate={() => open("render")} onRetry={retry} onDownload={download} /> },
        { key: "interop", label: tr("tabsInterop"), children: <InteropPanel onOpen={() => open("interop")} /> },
    ];
    return (
        <main className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-950">
            <div className="mx-auto max-w-7xl px-6 py-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <Space><Link to="/drama"><Button type="text" icon={<ArrowLeft className="size-4" />}>{tr("projects")}</Button></Link><div><Typography.Title level={3} className="!mb-0">{detail.project.title}</Typography.Title><Typography.Text type="secondary">Revision {detail.project.revision}</Typography.Text></div></Space>
                    <Space><Button onClick={() => open("project")}>{tr("projectSettings")}</Button><Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>{tr("refresh")}</Button></Space>
                </div>
                {error ? <Alert className="mb-4" type="warning" showIcon message={error} /> : null}
                <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Card size="small"><Statistic title={tr("statsShots")} value={detail.shots.length} /></Card><Card size="small"><Statistic title={tr("statsApproved")} value={approved} suffix={`/ ${detail.shots.length}`} /></Card><Card size="small"><Statistic title={tr("statsGenerations")} value={production.generations.length} /></Card><Card size="small"><Statistic title={tr("statsRenders")} value={renders.versions.length} /></Card></div>
                <Card><Tabs items={items} /></Card>
            </div>
            <Modal title={actionTitle(action)} open={!!action} okText={tr("submit")} cancelText={tr("cancel")} confirmLoading={saving} onOk={() => void submit()} onCancel={() => setAction(null)} destroyOnHidden width={680}>
                <Form form={form} layout="vertical" className="pt-3">{actionFields(action, shotOptions, generationOptions, detail.scripts.map((script) => ({ value: script.id, label: `v${script.version} · ${script.operation}` })))}</Form>
            </Modal>
        </main>
    );
}

function ScriptPanel({ detail, analyses, onAdd, onAnalyze, onApply }: { detail: CloudDramaDetail; analyses: GenerationJob[]; onAdd: () => void; onAnalyze: () => void; onApply: (jobId: string) => void }) { return <><Space><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>{tr("newScript")}</Button><Button disabled={!detail.scripts.length} onClick={onAnalyze}>{tr("startAnalysis")}</Button></Space><List className="mt-4" dataSource={detail.scripts} locale={{ emptyText: tr("noScripts") }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space>v{item.version}<Tag>{item.operation}</Tag><Tag color={item.reviewStatus === "approved" ? "green" : "default"}>{item.reviewStatus}</Tag></Space>} description={<Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{item.content}</Typography.Paragraph>} /></List.Item>} /><Typography.Title level={5} className="!mt-6">{tr("analysisJobs")}</Typography.Title><List dataSource={analyses} locale={{ emptyText: tr("noAnalyses") }} renderItem={(job) => <List.Item actions={job.status === "succeeded" ? [<Button key="apply" type="link" onClick={() => void onApply(job.id)}>{tr("applyAnalysis")}</Button>] : []}><List.Item.Meta title={<Space><StatusTag value={job.status} />{String(job.input.scriptVersionId)}</Space>} description={`${job.logicalModelId} · ${job.errorMessage || new Date(job.updatedAt).toLocaleString()}`} /></List.Item>} /></>; }
function EntityPanel({ detail, onAdd }: { detail: CloudDramaDetail; onAdd: () => void }) { return <><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>{tr("addEntity")}</Button><List grid={{ gutter: 12, xs: 1, md: 3 }} className="mt-4" dataSource={detail.entities} locale={{ emptyText: tr("noEntities") }} renderItem={(item) => <List.Item><Card size="small" title={item.name} extra={<Tag>{item.kind}</Tag>}><Typography.Paragraph ellipsis={{ rows: 2 }}>{item.description || tr("noDescription")}</Typography.Paragraph><Typography.Text type="secondary">{item.referenceAssetId ? tr("referenceAsset", { id: item.referenceAssetId }) : tr("noReference")}</Typography.Text></Card></List.Item>} /></>; }
function ShotPanel({ detail, onAdd }: { detail: CloudDramaDetail; onAdd: () => void }) { return <><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>{tr("addShot")}</Button><Table className="mt-4" rowKey="id" pagination={false} dataSource={detail.shots} columns={[{ title: tr("order"), dataIndex: "sortOrder", width: 70 }, { title: tr("shot"), dataIndex: "title" }, { title: "Prompt", dataIndex: "prompt", ellipsis: true }, { title: tr("framing"), dataIndex: "framing" }, { title: tr("cameraMovement"), dataIndex: "cameraMovement" }, { title: tr("duration"), dataIndex: "durationMs", render: (v: number) => `${v / 1000}s` }]} /></>; }
function GenerationPanel({ detail, production, costs, onGenerate, onSelect }: { detail: CloudDramaDetail; production: CloudDramaProductionState; costs: { estimated: number; actual: number }; onGenerate: () => void; onSelect: () => void }) { return <><Space><Button type="primary" disabled={!detail.shots.length} onClick={onGenerate}>{tr("generateMedia")}</Button><Button disabled={!production.generations.length} onClick={onSelect}>{tr("selectGeneration")}</Button></Space><Descriptions className="mt-4" bordered size="small" items={[{ key: "estimated", label: tr("estimatedCost"), children: `${costs.estimated} points` }, { key: "actual", label: tr("settledCost"), children: `${costs.actual} points` }]} /><Table className="mt-4" rowKey="id" pagination={false} dataSource={production.generations} columns={[{ title: tr("shot"), dataIndex: "shotId", render: (id: string) => shotName(detail, id) }, { title: tr("type"), dataIndex: "capability" }, { title: "Job ID", dataIndex: "generationJobId", ellipsis: true }, { title: tr("selection"), render: (_, item) => item.selected ? <Tag color="green">{tr("selected", { id: item.selectedAssetId })}</Tag> : <Tag>{tr("notSelected")}</Tag> }]} /></>; }
function TimelinePanel({ detail, production, onAdd }: { detail: CloudDramaDetail; production: CloudDramaProductionState; onAdd: () => void }) { return <><Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>{tr("addTimeline")}</Button><Table className="mt-4" rowKey="id" pagination={false} dataSource={production.timeline} columns={[{ title: tr("type"), dataIndex: "kind" }, { title: tr("shot"), dataIndex: "shotId", render: (id: string | null) => id ? shotName(detail, id) : tr("global") }, { title: tr("content"), dataIndex: "textContent", ellipsis: true }, { title: tr("voice"), dataIndex: "voice" }, { title: tr("interval"), render: (_, x) => `${x.startMs}–${x.endMs} ms` }, { title: tr("asset"), dataIndex: "assetId", ellipsis: true }]} /></>; }
function ReviewPanel({ detail, production, onAdd }: { detail: CloudDramaDetail; production: CloudDramaProductionState; onAdd: () => void }) { return <><Button type="primary" disabled={!detail.shots.length} onClick={onAdd}>{tr("submitReview")}</Button><List className="mt-4" dataSource={production.reviews} locale={{ emptyText: tr("noReviews") }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space>{shotName(detail, item.shotId)}<StatusTag value={item.status} /></Space>} description={item.comment || tr("noComment")} /><Typography.Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Typography.Text></List.Item>} /></>; }
function RenderPanel({ renders, onCreate, onRetry, onDownload }: { renders: CloudDramaRenderState; onCreate: () => void; onRetry: (job: CloudDramaRenderJob) => void; onDownload: (id: string, name: string) => void }) { return <><Button type="primary" onClick={onCreate}>{tr("createRender")}</Button><List className="mt-4" dataSource={renders.jobs} locale={{ emptyText: tr("noRenders") }} renderItem={(job) => <List.Item actions={[...(job.status === "failed" || job.status === "cancelled" ? [<Button key="retry" size="small" icon={<RotateCcw className="size-3" />} onClick={() => void onRetry(job)}>{tr("retry")}</Button>] : []), ...(job.outputAssetId ? [<Button key="download" size="small" icon={<Download className="size-3" />} onClick={() => void onDownload(job.outputAssetId!, `${job.kind}-${job.id}`)}>{tr("downloadOriginal")}</Button>] : [])]}><List.Item.Meta title={<Space><Tag>{job.kind}</Tag><StatusTag value={job.status} />Attempt {job.attempt}</Space>} description={<><Progress percent={job.progress} size="small" /><Typography.Text type={job.errorMessage ? "danger" : "secondary"}>{job.errorMessage || job.id}</Typography.Text></>} /></List.Item>} /><Typography.Title level={5} className="!mt-6">{tr("immutableVersions")}</Typography.Title><List dataSource={renders.versions} locale={{ emptyText: tr("noVersions") }} renderItem={(version) => <List.Item actions={[<Button key="download" type="link" onClick={() => void onDownload(version.assetId, `${version.kind}-v${version.version}`)}>{tr("download")}</Button>]}>{version.kind} v{version.version}</List.Item>} /></>; }
function InteropPanel({ onOpen }: { onOpen: () => void }) { return <div className="max-w-2xl"><Alert className="mb-4" showIcon type="info" message={tr("interopTitle")} description={tr("interopDescription")} /><Button type="primary" onClick={onOpen}>{tr("createInterop")}</Button></div>; }

function actionFields(action: Action, shots: Array<{ value: string; label: string }>, generations: Array<{ value: string; label: string }>, scripts: Array<{ value: string; label: string }>) {
    const required = [{ required: true }];
    if (action === "project") return <><Form.Item name="title" label={tr("projectName")} rules={required}><Input /></Form.Item><Form.Item name="sourceText" label={tr("sourceText")}><Input.TextArea rows={8} /></Form.Item><Form.Item name="sourceAssetId" label={tr("sourceAssetId")}><Input allowClear /></Form.Item></>;
    if (action === "script") return <><Form.Item name="operation" label={tr("formOperation")} rules={required}><Select options={["revision", "split", "merge", "analysis"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="reviewStatus" label={tr("formReviewStatus")} rules={required}><Select options={["draft", "reviewing", "approved", "rejected"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="content" label={tr("formScriptContent")} rules={required}><Input.TextArea rows={10} /></Form.Item><Form.Item name="segments" label={tr("formSegments")}><Input.TextArea rows={3} /></Form.Item><Form.Item name="analysis" label={tr("formAnalysis")}><Input.TextArea rows={3} /></Form.Item></>;
    if (action === "analysis") return <><Alert className="mb-4" type="info" showIcon message={tr("analysisHint")} /><Form.Item name="scriptVersionId" label={tr("sourceScriptVersion")} rules={required}><Select options={scripts} /></Form.Item><Form.Item name="logicalModelId" label="Text Logical Model ID" rules={required}><Input placeholder="text/default" /></Form.Item></>;
    if (action === "entity") return <><Form.Item name="kind" label={tr("formKind")} rules={required}><Select options={[{ value: "character", label: tr("character") }, { value: "scene", label: tr("scene") }, { value: "prop", label: tr("prop") }]} /></Form.Item><Form.Item name="name" label={tr("formName")} rules={required}><Input /></Form.Item><Form.Item name="description" label={tr("formDescription")}><Input.TextArea /></Form.Item><Form.Item name="prompt" label="Prompt"><Input.TextArea /></Form.Item><Form.Item name="referenceAssetId" label={tr("formReferenceAsset")}><Input /></Form.Item><Form.Item name="sortOrder" label={tr("order")} rules={required}><InputNumber min={0} /></Form.Item></>;
    if (action === "shot") return <><Form.Item name="title" label={tr("shotTitle")} rules={required}><Input /></Form.Item><Form.Item name="prompt" label="Prompt"><Input.TextArea /></Form.Item><Form.Item name="framing" label={tr("framing")}><Input /></Form.Item><Form.Item name="cameraMovement" label={tr("cameraMovement")}><Input /></Form.Item><Form.Item name="durationMs" label={tr("durationMs")} rules={required}><InputNumber min={100} /></Form.Item><Form.Item name="sortOrder" label={tr("order")} rules={required}><InputNumber min={0} /></Form.Item></>;
    if (action === "generation") return <><Form.Item name="shotId" label={tr("shot")} rules={required}><Select options={shots} /></Form.Item><Form.Item name="capability" label={tr("generationType")} rules={required}><Select options={[{ value: "image", label: tr("image") }, { value: "video", label: tr("video") }]} /></Form.Item><Form.Item name="logicalModelId" label="Logical Model ID" rules={required}><Input placeholder="image/default" /></Form.Item><Form.Item name="parameters" label={tr("parametersJson")} rules={required}><Input.TextArea rows={5} /></Form.Item></>;
    if (action === "selection") return <><Form.Item name="generationId" label={tr("generationVersion")} rules={required}><Select options={generations} /></Form.Item><Form.Item name="assetId" label={tr("generationAsset")} rules={required}><Input /></Form.Item></>;
    if (action === "timeline") return <><Form.Item name="kind" label={tr("formKind")} rules={required}><Select options={["dialogue", "voice", "bgm", "subtitle"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="shotId" label={tr("linkedShot")}><Select allowClear options={shots} /></Form.Item><Form.Item name="textContent" label={tr("dialogueSubtitle")}><Input.TextArea /></Form.Item><Form.Item name="voice" label={tr("voice")}><Input /></Form.Item><Form.Item name="assetId" label={tr("audioAsset")}><Input /></Form.Item><Space><Form.Item name="startMs" label={tr("startMs")} rules={required}><InputNumber min={0} /></Form.Item><Form.Item name="endMs" label={tr("endMs")} rules={required}><InputNumber min={1} /></Form.Item><Form.Item name="sortOrder" label={tr("order")} rules={required}><InputNumber min={0} /></Form.Item></Space></>;
    if (action === "review") return <><Form.Item name="shotId" label={tr("shot")} rules={required}><Select options={shots} /></Form.Item><Form.Item name="status" label={tr("conclusion")} rules={required}><Select options={[{ value: "pending", label: tr("pending") }, { value: "approved", label: tr("approved") }, { value: "changes_requested", label: tr("changesRequested") }]} /></Form.Item><Form.Item name="comment" label={tr("teamComment")}><Input.TextArea rows={5} /></Form.Item></>;
    if (action === "render") return <><Alert className="mb-4" type="info" showIcon message={tr("renderHint")} /><Form.Item name="kind" label={tr("deliveryType")} rules={required}><Select options={[{ value: "ffmpeg", label: tr("ffmpegMovie") }, { value: "jianying", label: tr("jianyingZip") }]} /></Form.Item><Form.Item noStyle shouldUpdate={(before, after) => before.kind !== after.kind}>{({ getFieldValue }) => getFieldValue("kind") === "jianying" ? <><Space wrap><Form.Item name="jianyingVersion" label={tr("jianyingVersion")} rules={required}><Select className="w-36" options={[{ value: "5", label: "5.x" }, { value: "6", label: "6+" }]} /></Form.Item><Form.Item name="width" label={tr("canvasWidth")} rules={required}><InputNumber min={1} max={8192} /></Form.Item><Form.Item name="height" label={tr("canvasHeight")} rules={required}><InputNumber min={1} max={8192} /></Form.Item><Form.Item name="fps" label="FPS" rules={required}><InputNumber min={1} max={120} /></Form.Item></Space><Form.Item name="draftPath" label={tr("jianyingDraftPath")} extra={tr("jianyingDraftPathHelp")}><Input placeholder="C:\\Users\\name\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft" /></Form.Item></> : <Form.Item name="fps" label="FPS" rules={required}><InputNumber min={1} max={120} /></Form.Item>}</Form.Item><Form.Item name="settings" label={tr("advancedRenderSettings")} extra={tr("advancedRenderSettingsHelp")} rules={required}><Input.TextArea rows={4} /></Form.Item></>;
    if (action === "interop") return <><Form.Item name="direction" label={tr("direction")} rules={required}><Select options={[{ value: "from-asset", label: tr("fromAsset") }, { value: "from-canvas", label: tr("fromCanvas") }, { value: "to-canvas", label: tr("toCanvas") }]} /></Form.Item><Form.Item name="assetId" label={tr("cloudAssetHelp")}><Input /></Form.Item><Form.Item name="canvasProjectId" label={tr("canvasProjectHelp")}><Input /></Form.Item><Form.Item name="nodeId" label={tr("canvasNodeHelp")}><Input /></Form.Item><Form.Item name="expectedCanvasRevision" label={tr("canvasRevisionHelp")}><InputNumber min={0} /></Form.Item><Form.Item name="targetKind" label={tr("targetKind")}><Select options={[{ value: "character", label: tr("character") }, { value: "scene", label: tr("scene") }, { value: "prop", label: tr("prop") }]} /></Form.Item><Form.Item name="name" label={tr("entityNodeTitle")}><Input /></Form.Item><Form.Item name="description" label={tr("entityDescription")}><Input.TextArea /></Form.Item><Form.Item name="prompt" label={tr("entityPrompt")}><Input.TextArea /></Form.Item><Space><Form.Item name="sortOrder" label={tr("entityOrder")}><InputNumber min={0} /></Form.Item><Form.Item name="x" label="Canvas X"><InputNumber /></Form.Item><Form.Item name="y" label="Canvas Y"><InputNumber /></Form.Item></Space></>;
    return null;
}
function actionTitle(action: Action) { const key = ({ project: "projectSettings", script: "actionScript", analysis: "actionAnalysis", entity: "actionEntity", shot: "actionShot", generation: "actionGeneration", selection: "actionSelection", timeline: "actionTimeline", review: "actionReview", render: "actionRender", interop: "actionInterop" } as Record<string, string>)[action || ""]; return key ? tr(key) : ""; }
function StatusTag({ value }: { value: string }) { const color = value === "succeeded" || value === "approved" ? "green" : value === "failed" || value === "changes_requested" ? "red" : value === "running" ? "blue" : "default"; return <Tag color={color}>{value}</Tag>; }
function shotName(detail: CloudDramaDetail, id: string) { return detail.shots.find((shot) => shot.id === id)?.title || id; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function optional(value: unknown) { const result = text(value); return result || null; }
function number(value: unknown) { return Number(value); }
function jsonObject(value: unknown) { const parsed = JSON.parse(text(value) || "{}"); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(tr("jsonObjectError")); return parsed as Record<string, unknown>; }
function jsonArray(value: unknown) { const parsed = JSON.parse(text(value) || "[]"); if (!Array.isArray(parsed)) throw new Error(tr("jsonArrayError")); return parsed; }
function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
function tr(key: string, options?: Record<string, unknown>) { return i18n.t(`drama.${key}`, options); }
