import type { Position } from "@/types/canvas";

export type CanvasFileKind = "image" | "video" | "audio" | "text";

export type CanvasDropFileLike = {
    name: string;
    type: string;
};

export type CanvasFileDropPlan<T extends CanvasDropFileLike = CanvasDropFileLike> = {
    file: T;
    kind: CanvasFileKind;
    position: Position;
};

const EXTENSION_KINDS: Readonly<Record<string, CanvasFileKind>> = {
    png: "image",
    jpg: "image",
    jpeg: "image",
    webp: "image",
    gif: "image",
    bmp: "image",
    svg: "image",
    avif: "image",
    mp4: "video",
    webm: "video",
    mov: "video",
    m4v: "video",
    mkv: "video",
    mp3: "audio",
    wav: "audio",
    ogg: "audio",
    opus: "audio",
    m4a: "audio",
    aac: "audio",
    flac: "audio",
    txt: "text",
    md: "text",
    markdown: "text",
    json: "text",
    csv: "text",
    log: "text",
};

export function classifyCanvasFile(file: CanvasDropFileLike): CanvasFileKind | null {
    const mimeType = file.type.trim().toLowerCase();
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";

    // Browsers frequently omit MIME types for local media. Only fall back to the
    // extension when the type is absent or explicitly generic; a conflicting
    // concrete MIME type must not be treated as trusted media.
    if (mimeType && mimeType !== "application/octet-stream") return null;
    const extension = file.name.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    return extension ? EXTENSION_KINDS[extension] || null : null;
}

export function planCanvasFileDrops<T extends CanvasDropFileLike>(files: readonly T[], basePosition: Position, stagger = 40): CanvasFileDropPlan<T>[] {
    if (!Number.isFinite(stagger) || stagger < 0) throw new Error("Canvas file drop stagger must be a non-negative finite number");
    return files.flatMap((file) => {
        const kind = classifyCanvasFile(file);
        return kind ? [{ file, kind }] : [];
    }).map((item, index) => ({ ...item, position: { x: basePosition.x + index * stagger, y: basePosition.y + index * stagger } }));
}
