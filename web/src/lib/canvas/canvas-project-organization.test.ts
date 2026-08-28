import { describe, expect, it } from "vitest";
import { inferCanvasProjectCover, organizeCanvasProjects } from "@/lib/canvas/canvas-project-organization";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { buildCanvasTemplateNodes } from "@/lib/canvas/canvas-project-templates";

const project = (id: string, patch: Partial<CanvasProject> = {}) => ({ id, title: id, updatedAt: "2026-01-01T00:00:00Z", lastOpenedAt: "2026-01-01T00:00:00Z", nodes: [], ...patch }) as CanvasProject;

describe("canvas project organization [CAN-015]", () => {
    it("filters folders and favorites and sorts by recent access", () => {
        const projects = [project("old", { folderId: "campaign", favorite: true }), project("new", { folderId: "campaign", favorite: true, lastOpenedAt: "2026-02-01T00:00:00Z" }), project("other", { folderId: "archive", favorite: true })];
        expect(organizeCanvasProjects(projects, { folderId: "campaign", favoritesOnly: true }).map((item) => item.id)).toEqual(["new", "old"]);
    });

    it("uses an explicit cover before deriving one from the first image node", () => {
        const withImage = project("image", { nodes: [{ id: "n", type: "image", title: "n", position: { x: 0, y: 0 }, width: 1, height: 1, metadata: { content: "blob:derived" } }] });
        expect(inferCanvasProjectCover(withImage)).toBe("blob:derived");
        expect(inferCanvasProjectCover({ ...withImage, coverUrl: "https://cdn.example/cover.png" })).toBe("https://cdn.example/cover.png");
        expect(inferCanvasProjectCover({ ...withImage, coverUrl: "javascript:alert(1)", nodes: [] })).toBeUndefined();
    });

    it("creates stable blank, storyboard, and campaign template structures", () => {
        let id = 0;
        expect(buildCanvasTemplateNodes("blank", () => `${++id}`)).toEqual([]);
        expect(buildCanvasTemplateNodes("storyboard", () => `${++id}`).map((node) => node.type)).toEqual(["text", "image", "video"]);
        expect(buildCanvasTemplateNodes("campaign", () => `${++id}`).map((node) => node.type)).toEqual(["text", "config", "image"]);
    });
});
