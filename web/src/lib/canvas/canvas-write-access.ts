import type { CloudWorkspace } from "@/services/cloud-platform";

export function isCanvasReadOnly(serverMode: boolean, role: CloudWorkspace["role"] | undefined) {
    return serverMode && role === "viewer";
}

export function assertCanvasWritable(readOnly: boolean): void {
    if (!readOnly) return;
    const error = new Error("CANVAS_READ_ONLY");
    error.name = "CanvasReadOnlyError";
    throw error;
}

export function isReadOnlyWriteKey(input: { key: string; metaKey?: boolean; ctrlKey?: boolean }) {
    const key = input.key.toLowerCase();
    return key === "delete" || key === "backspace" || ((input.metaKey || input.ctrlKey) && ["v", "z", "y"].includes(key));
}
