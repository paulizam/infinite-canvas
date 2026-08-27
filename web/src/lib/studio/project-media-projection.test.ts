import { describe, expect, it } from "vitest";

import { projectCanvasMedia, projectGenerationJobAssets, projectWorkspaceAssets } from "./project-media-projection";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const project = {
    id: "project-1",
    revision: 7,
    nodes: [
        { id: "text-1", type: "text", title: "Copy", metadata: { content: "Primary", texts: [{ id: "v2", content: "Alternative", status: "success" }] } },
        {
            id: "image-1",
            type: "image",
            title: "Hero",
            metadata: { content: "data:image/png;base64,AA", mimeType: "image/png", images: [{ id: "same", content: "data:image/png;base64,AA", status: "success", naturalWidth: 10, naturalHeight: 10, bytes: 2, mimeType: "image/png" }] },
        },
        { id: "audio-1", type: "audio", title: "Voice", metadata: { content: "blob:voice", mimeType: "audio/mpeg", durationMs: 1200 } },
    ],
} as CanvasProject;

describe("project media projection", () => {
    it("projects node outputs and deduplicates identical variants", () => {
        const items = projectCanvasMedia(project);
        expect(items.map((item) => [item.kind, item.variant])).toEqual([
            ["text", "primary"],
            ["text", "alternative"],
            ["image", "primary"],
            ["audio", "primary"],
        ]);
        expect(items.every((item) => item.projectRevision === 7 && item.source === "canvas")).toBe(true);
    });

    it("labels workspace assets without claiming project ownership", () => {
        const [item] = projectWorkspaceAssets(project, [{ id: "asset-1", workspaceId: "ws", kind: "video", mimeType: "video/mp4", bytes: 4, originalName: "clip.mp4", createdAt: "2026-01-01" }]);
        expect(item).toMatchObject({ source: "workspace_asset", kind: "video", assetId: "asset-1" });
        expect(item.nodeId).toBeUndefined();
    });

    it("extracts nested generation asset refs while ignoring text results", () => {
        const items = projectGenerationJobAssets(project, [
            { id: "job-1", workspaceId: "ws", capability: "image", status: "succeeded", result: { output: [{ assetId: "asset-2", mimeType: "image/webp", width: 512 }] }, logicalModelId: "image/default", createdAt: "2026-01-01" },
            { id: "job-2", workspaceId: "ws", capability: "text", status: "succeeded", result: { text: "done" }, logicalModelId: "text/default", createdAt: "2026-01-01" },
        ] as never);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ source: "generation_job", assetId: "asset-2", width: 512 });
    });
});
