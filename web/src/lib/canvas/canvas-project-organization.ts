import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasProjectSort = "recent" | "updated" | "title";

export function organizeCanvasProjects(projects: readonly CanvasProject[], options: { folderId?: string | null; favoritesOnly?: boolean; query?: string; sort?: CanvasProjectSort } = {}) {
    const query = options.query?.trim().toLocaleLowerCase() || "";
    return projects
        .filter((project) => {
            if (options.folderId !== undefined && project.folderId !== options.folderId) return false;
            if (options.favoritesOnly && !project.favorite) return false;
            return !query || project.title.toLocaleLowerCase().includes(query);
        })
        .sort((a, b) => {
            if (options.sort === "title") return a.title.localeCompare(b.title);
            const bDate = options.sort === "updated" ? b.updatedAt : b.lastOpenedAt || b.updatedAt;
            const aDate = options.sort === "updated" ? a.updatedAt : a.lastOpenedAt || a.updatedAt;
            return Date.parse(bDate) - Date.parse(aDate);
        });
}

export function inferCanvasProjectCover(project: CanvasProject) {
    const cover = project.coverUrl || project.nodes.find((node) => node.type === "image" && node.metadata?.content)?.metadata?.content;
    return cover && /^(?:https?:\/\/|data:image\/|blob:|\/)/i.test(cover) ? cover : undefined;
}
