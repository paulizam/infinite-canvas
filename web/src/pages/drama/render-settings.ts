export function buildDramaRenderSettings(
    kind: unknown,
    values: Record<string, unknown>,
    advanced: Record<string, unknown>,
) {
    const fps = integer(values.fps, "fps", 1, 120);
    if (kind === "ffmpeg") return { ...advanced, fps };
    if (kind !== "jianying") throw new Error("Unsupported render kind");
    const version = values.jianyingVersion;
    if (version !== "5" && version !== "6") throw new Error("Jianying version must be 5 or 6");
    const width = integer(values.width, "width", 1, 8192);
    const height = integer(values.height, "height", 1, 8192);
    const draftPath = typeof values.draftPath === "string" ? values.draftPath.trim() : "";
    if (draftPath && !absolutePath(draftPath)) throw new Error("Jianying draft path must be absolute");
    return {
        ...advanced,
        fps,
        width,
        height,
        jianyingVersion: version,
        ...(draftPath ? { draftPath } : {}),
    };
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    return parsed;
}
function absolutePath(value: string) {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/");
}
