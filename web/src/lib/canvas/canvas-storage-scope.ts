export function canvasStorageName(name: string, serverMode: boolean, selectedWorkspaceId?: string | null) {
    if (!serverMode) return name;
    const storedWorkspaceId = selectedWorkspaceId === undefined && typeof localStorage !== "undefined" ? localStorage.getItem("infinite-canvas:active-workspace") : selectedWorkspaceId;
    return `${name}:cloud:${storedWorkspaceId || "pending"}`;
}
