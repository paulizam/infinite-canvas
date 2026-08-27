import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Select, Spin, Tag } from "antd";
import { ArrowLeft, Clapperboard, Download, ExternalLink, Grid2X2, ImageIcon, Layers3, RefreshCw } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { projectCanvasMedia, projectGenerationJobAssets, projectWorkspaceAssets, type StudioMediaItem, type StudioMediaKind, type StudioMediaSource } from "@/lib/studio/project-media-projection";
import { cloudModeEnabled, cloudPlatform, type CloudAsset } from "@/services/cloud-platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";
import type { GenerationJob } from "@infinite-canvas/contracts";

type GroupMode = "media" | "node" | "version";

export default function StudioProjectPage() {
    const { id = "" } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { message } = App.useApp();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === id));
    const workspaceId = useCloudSessionStore((state) => state.activeWorkspaceId);
    const authenticated = useCloudSessionStore((state) => state.status === "authenticated");
    const [assets, setAssets] = useState<CloudAsset[]>([]);
    const [jobs, setJobs] = useState<GenerationJob[]>([]);
    const [loadingCloud, setLoadingCloud] = useState(false);
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState<"all" | StudioMediaKind>("all");
    const [source, setSource] = useState<"all" | StudioMediaSource>("all");
    const [nodeId, setNodeId] = useState("all");
    const [groupMode, setGroupMode] = useState<GroupMode>("media");

    const loadCloud = async () => {
        if (!cloudModeEnabled || !authenticated || !workspaceId) return;
        setLoadingCloud(true);
        try {
            const [nextAssets, nextJobs] = await Promise.all([cloudPlatform.listAssets(workspaceId), cloudPlatform.listGenerationJobs(workspaceId)]);
            setAssets(nextAssets);
            setJobs(nextJobs);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("studio.loadFailed"));
        } finally {
            setLoadingCloud(false);
        }
    };

    useEffect(() => void loadCloud(), [authenticated, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    const items = useMemo(() => {
        if (!project) return [];
        return [...projectCanvasMedia(project), ...projectWorkspaceAssets(project, assets), ...projectGenerationJobAssets(project, jobs)];
    }, [assets, jobs, project]);
    const filteredItems = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return items.filter((item) => {
            if (kind !== "all" && item.kind !== kind) return false;
            if (source !== "all" && item.source !== source) return false;
            if (nodeId !== "all" && item.nodeId !== nodeId) return false;
            return !needle || `${item.nodeTitle} ${item.prompt || ""} ${item.text || ""} ${item.mimeType || ""}`.toLocaleLowerCase().includes(needle);
        });
    }, [items, kind, nodeId, query, source]);
    const groups = useMemo(() => groupItems(filteredItems, groupMode, t), [filteredItems, groupMode, t]);

    if (!hydrated)
        return (
            <div className="grid h-full place-items-center">
                <Spin />
            </div>
        );
    if (!project)
        return (
            <div className="grid h-full place-items-center">
                <Empty description={t("studio.projectMissing")}>
                    <Button onClick={() => navigate("/canvas")}>{t("studio.projects")}</Button>
                </Empty>
            </div>
        );

    const download = async (item: StudioMediaItem) => {
        try {
            if (item.assetId) {
                const blob = await cloudPlatform.downloadAsset(item.assetId);
                saveAs(blob, fileName(item));
            } else if (item.url) saveAs(item.url, fileName(item));
            else if (item.text) saveAs(new Blob([item.text], { type: "text/plain;charset=utf-8" }), fileName(item));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("studio.downloadFailed"));
        }
    };

    return (
        <main className="flex h-full min-h-0 flex-col bg-stone-50 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-5 dark:border-stone-800 dark:bg-stone-900">
                <div className="flex min-w-0 items-center gap-3">
                    <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/canvas")} aria-label={t("studio.projects")} />
                    <span className="grid size-9 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                        <Clapperboard className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="truncate font-semibold">{project.title}</h1>
                        <p className="text-xs text-stone-500">{t("studio.revision", { revision: project.revision })}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {cloudModeEnabled && authenticated ? (
                        <Button icon={<RefreshCw className="size-4" />} loading={loadingCloud} onClick={() => void loadCloud()}>
                            {t("studio.refresh")}
                        </Button>
                    ) : null}
                    <Button type="primary" icon={<Grid2X2 className="size-4" />} onClick={() => navigate(`/canvas/${id}`)}>
                        {t("studio.canvasView")}
                    </Button>
                </div>
            </header>

            <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                    <Input.Search className="min-w-52 flex-1" allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("studio.search")} />
                    <Select value={kind} onChange={setKind} className="w-32" options={["all", "text", "image", "video", "audio"].map((value) => ({ value, label: t(`studio.kind.${value}`) }))} />
                    <Select value={source} onChange={setSource} className="w-44" options={["all", "canvas", "workspace_asset", "generation_job"].map((value) => ({ value, label: t(`studio.source.${value}`) }))} />
                    <Select value={nodeId} onChange={setNodeId} className="w-44" options={[{ value: "all", label: t("studio.allNodes") }, ...project.nodes.map((node) => ({ value: node.id, label: node.title || node.id }))]} />
                    <Select value={groupMode} onChange={setGroupMode} className="w-36" options={["media", "node", "version"].map((value) => ({ value, label: t(`studio.group.${value}`) }))} />
                </div>

                <div className="flex items-center justify-between text-sm text-stone-500">
                    <span>{t("studio.resultCount", { count: filteredItems.length })}</span>
                    <span>{t("studio.sameProjectHint")}</span>
                </div>
                {!filteredItems.length ? (
                    <div className="grid flex-1 place-items-center">
                        <Empty image={<ImageIcon className="mx-auto size-14 text-stone-300" />} description={t("studio.empty")} />
                    </div>
                ) : null}
                {groups.map(([label, group]) => (
                    <section key={label} className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Layers3 className="size-4 text-violet-500" />
                            <h2 className="font-medium">{label}</h2>
                            <Tag>{group.length}</Tag>
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                            {group.map((item) => (
                                <MediaCard key={item.id} item={item} onDownload={() => void download(item)} onFocus={item.nodeId ? () => navigate(`/canvas/${id}?focusNode=${encodeURIComponent(item.nodeId!)}`) : undefined} t={t} />
                            ))}
                        </div>
                    </section>
                ))}
            </section>
        </main>
    );
}

function MediaCard({ item, onDownload, onFocus, t }: { item: StudioMediaItem; onDownload: () => void; onFocus?: () => void; t: (key: string, options?: Record<string, unknown>) => string }) {
    const url = item.url || (item.assetId ? cloudPlatform.assetContentUrl(item.assetId) : undefined);
    return (
        <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="grid aspect-video place-items-center overflow-hidden bg-stone-100 dark:bg-stone-950">
                {item.kind === "image" && url ? <img src={url} alt={item.nodeTitle} className="h-full w-full object-contain" loading="lazy" /> : null}
                {item.kind === "video" && url ? <video src={url} className="h-full w-full object-contain" controls preload="metadata" /> : null}
                {item.kind === "audio" && url ? <audio src={url} className="w-[90%]" controls preload="metadata" /> : null}
                {item.kind === "text" ? <p className="line-clamp-6 whitespace-pre-wrap p-5 text-sm leading-6">{item.text}</p> : null}
            </div>
            <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium" title={item.nodeTitle}>
                            {item.nodeTitle}
                        </h3>
                        <p className="truncate text-xs text-stone-500">
                            {t(`studio.source.${item.source}`)} · {item.variant}
                        </p>
                    </div>
                    <Tag color={item.status === "error" ? "error" : item.status === "loading" ? "processing" : "default"}>{t(`studio.kind.${item.kind}`)}</Tag>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
                    <span>{formatMeta(item)}</span>
                    <span className="flex">
                        <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={onDownload} aria-label={t("studio.download")} />
                        {onFocus ? <Button type="text" size="small" icon={<ExternalLink className="size-3.5" />} onClick={onFocus} aria-label={t("studio.focusNode")} /> : null}
                    </span>
                </div>
            </div>
        </article>
    );
}

function groupItems(items: StudioMediaItem[], mode: GroupMode, t: (key: string, options?: Record<string, unknown>) => string) {
    const groups = new Map<string, StudioMediaItem[]>();
    for (const item of items) {
        const key = mode === "media" ? t(`studio.kind.${item.kind}`) : mode === "node" ? item.nodeTitle : t("studio.revision", { revision: item.projectRevision });
        groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()];
}

function formatMeta(item: StudioMediaItem) {
    const dimensions = item.width && item.height ? `${item.width}×${item.height}` : "";
    const duration = item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : "";
    const bytes = item.bytes ? `${(item.bytes / 1024).toFixed(item.bytes > 1024 * 1024 ? 0 : 1)} KB` : "";
    return [dimensions, duration, bytes, item.mimeType].filter(Boolean).join(" · ") || "—";
}

function fileName(item: StudioMediaItem) {
    const safe = item.nodeTitle.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "asset";
    const ext =
        item.mimeType
            ?.split("/")[1]
            ?.replace("jpeg", "jpg")
            .replace(/[^a-z0-9]/gi, "") || (item.kind === "text" ? "txt" : item.kind);
    return `${safe}-${item.variant}.${ext}`;
}
