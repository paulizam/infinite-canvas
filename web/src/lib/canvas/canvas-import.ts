import type { CanvasExportFile } from "@/types/canvas-export";

export function validateCanvasImportAssets(data: CanvasExportFile, entries: Map<string, Blob>) {
    return data.projects.flatMap((project) =>
        project.files.map((file) => {
            const blob = entries.get(file.path);
            if (!blob) throw new Error("Canvas export asset is missing");
            if (blob.size !== file.bytes) throw new Error("Canvas export asset size mismatch");
            return { file, blob: blob.type ? blob : blob.slice(0, blob.size, file.mimeType) };
        }),
    );
}

export function parseCanvasExportFile(value: unknown): CanvasExportFile {
    if (!value || typeof value !== "object") throw new Error("Invalid canvas export");
    const data = value as Partial<CanvasExportFile>;
    if (data.app !== "infinite-canvas" || (data.version !== 3 && data.version !== 4) || !Array.isArray(data.projects)) throw new Error("Unsupported canvas export");
    if (data.projects.length > 1_000) throw new Error("Canvas export contains too many projects");
    const paths = new Set<string>();
    const storageKeys = new Set<string>();
    let totalBytes = 0;
    for (const item of data.projects) {
        if (!item?.project || !Array.isArray(item.files) || !Array.isArray(item.project.nodes) || !Array.isArray(item.project.connections)) throw new Error("Invalid canvas project export");
        const id = item.project.id;
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || item.files.length > 10_000) throw new Error("Invalid canvas project export");
        for (const file of item.files) {
            if (!file || typeof file !== "object" || typeof file.path !== "string" || !file.path.startsWith(`projects/${id}/files/`) || file.path.includes("..") || !/^projects\/[A-Za-z0-9_-]+\/files\/[A-Za-z0-9_.-]+$/.test(file.path))
                throw new Error("Invalid canvas asset path");
            if (typeof file.storageKey !== "string" || !/^(?:image|video|audio|file):[A-Za-z0-9_-]{1,200}$/.test(file.storageKey)) throw new Error("Invalid canvas storage key");
            if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 64 * 1024 * 1024) throw new Error("Canvas asset exceeds size limit");
            if (typeof file.mimeType !== "string" || file.mimeType.length > 200 || paths.has(file.path) || storageKeys.has(file.storageKey)) throw new Error("Duplicate or malformed canvas asset");
            paths.add(file.path);
            storageKeys.add(file.storageKey);
            totalBytes += file.bytes;
            if (totalBytes > 512 * 1024 * 1024) throw new Error("Canvas export exceeds total size limit");
        }
    }
    return data as CanvasExportFile;
}
