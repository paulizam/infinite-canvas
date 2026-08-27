import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3 | 4;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: Partial<CanvasProject> & Pick<CanvasProject, "id" | "title" | "nodes" | "connections">;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
