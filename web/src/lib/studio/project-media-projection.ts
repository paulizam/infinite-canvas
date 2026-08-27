import type { AssetRef, GenerationJob } from "@infinite-canvas/contracts";

import type { CloudAsset } from "@/services/cloud-platform";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeStatus } from "@/types/canvas";

export type StudioMediaKind = "text" | "image" | "video" | "audio";
export type StudioMediaSource = "canvas" | "workspace_asset" | "generation_job";

export type StudioMediaItem = {
    id: string;
    projectId: string;
    projectRevision: number;
    nodeId?: string;
    nodeTitle: string;
    kind: StudioMediaKind;
    source: StudioMediaSource;
    variant: string;
    url?: string;
    assetId?: string;
    text?: string;
    mimeType?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    prompt?: string;
    status: CanvasNodeStatus;
    createdAt?: string;
};

export function projectCanvasMedia(project: CanvasProject): StudioMediaItem[] {
    const items: StudioMediaItem[] = [];
    const seen = new Set<string>();
    const add = (item: StudioMediaItem) => {
        const payload = item.assetId || item.url || item.text || item.id;
        const key = `${item.kind}:${item.nodeId || ""}:${payload}`;
        if (!payload || seen.has(key)) return;
        seen.add(key);
        items.push(item);
    };

    for (const node of project.nodes) {
        const metadata = node.metadata || {};
        const base = {
            projectId: project.id,
            projectRevision: project.revision,
            nodeId: node.id,
            nodeTitle: node.title || node.id,
            source: "canvas" as const,
            prompt: metadata.prompt,
            status: metadata.status || ("idle" as const),
        };
        if (node.type === CanvasNodeType.Text) {
            add({ ...base, id: `${node.id}:text:primary`, kind: "text", variant: "primary", text: metadata.content });
            for (const text of metadata.texts || []) add({ ...base, id: `${node.id}:text:${text.id}`, kind: "text", variant: text.id === metadata.primaryTextId ? "primary" : "alternative", text: text.content, status: text.status });
        }
        if (node.type === CanvasNodeType.Image) {
            add({ ...base, id: `${node.id}:image:primary`, kind: "image", variant: "primary", url: metadata.content, mimeType: metadata.mimeType, bytes: metadata.bytes, width: metadata.naturalWidth, height: metadata.naturalHeight });
            for (const image of metadata.images || [])
                add({
                    ...base,
                    id: `${node.id}:image:${image.id}`,
                    kind: "image",
                    variant: image.id === metadata.primaryImageId ? "primary" : "alternative",
                    url: image.content,
                    mimeType: image.mimeType,
                    bytes: image.bytes,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                    status: image.status,
                });
        }
        if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
            const kind = node.type === CanvasNodeType.Video ? "video" : "audio";
            add({ ...base, id: `${node.id}:${kind}:primary`, kind, variant: "primary", url: metadata.content, mimeType: metadata.mimeType, bytes: metadata.bytes, durationMs: metadata.durationMs });
        }
    }
    return items;
}

export function projectWorkspaceAssets(project: CanvasProject, assets: CloudAsset[]): StudioMediaItem[] {
    return assets.map((asset) => ({
        id: `asset:${asset.id}`,
        projectId: project.id,
        projectRevision: project.revision,
        nodeTitle: asset.originalName,
        kind: asset.kind,
        source: "workspace_asset",
        variant: "original",
        assetId: asset.id,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        status: "success",
        createdAt: asset.createdAt,
    }));
}

export function projectGenerationJobAssets(project: CanvasProject, jobs: GenerationJob[]): StudioMediaItem[] {
    const items: StudioMediaItem[] = [];
    for (const job of jobs) {
        const refs = collectAssetRefs(job.result);
        refs.forEach((ref, index) => {
            const kind = kindFromMime(ref.mimeType) || (job.capability === "image" || job.capability === "video" || job.capability === "audio" ? job.capability : undefined);
            if (!kind) return;
            items.push({
                id: `job:${job.id}:${ref.assetId}:${index}`,
                projectId: project.id,
                projectRevision: project.revision,
                nodeTitle: job.logicalModelId,
                kind,
                source: "generation_job",
                variant: ref.variant || "result",
                assetId: ref.assetId,
                mimeType: ref.mimeType,
                width: ref.width,
                height: ref.height,
                durationMs: ref.durationMs,
                status: job.status === "failed" ? "error" : job.status === "succeeded" ? "success" : "loading",
                createdAt: job.createdAt,
            });
        });
    }
    return items;
}

function kindFromMime(mimeType?: string): Exclude<StudioMediaKind, "text"> | undefined {
    const kind = mimeType?.split("/", 1)[0];
    return kind === "image" || kind === "video" || kind === "audio" ? kind : undefined;
}

function collectAssetRefs(value: unknown): AssetRef[] {
    const refs: AssetRef[] = [];
    const visit = (entry: unknown, depth: number) => {
        if (depth > 8 || entry === null || typeof entry !== "object") return;
        if (Array.isArray(entry)) return entry.forEach((item) => visit(item, depth + 1));
        const record = entry as Record<string, unknown>;
        if (typeof record.assetId === "string") {
            refs.push(record as AssetRef);
            return;
        }
        Object.values(record).forEach((item) => visit(item, depth + 1));
    };
    visit(value, 0);
    return refs;
}
