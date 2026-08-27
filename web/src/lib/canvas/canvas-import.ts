import type { CanvasExportFile } from "@/types/canvas-export";

export function parseCanvasExportFile(value: unknown): CanvasExportFile {
    if (!value || typeof value !== "object") throw new Error("Invalid canvas export");
    const data = value as Partial<CanvasExportFile>;
    if (data.app !== "infinite-canvas" || (data.version !== 3 && data.version !== 4) || !Array.isArray(data.projects)) throw new Error("Unsupported canvas export");
    for (const item of data.projects) if (!item?.project || !Array.isArray(item.files)) throw new Error("Invalid canvas project export");
    return data as CanvasExportFile;
}
