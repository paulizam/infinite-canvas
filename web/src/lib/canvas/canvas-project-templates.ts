import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasProjectTemplateId = "blank" | "storyboard" | "campaign";

export const CANVAS_PROJECT_TEMPLATES: Array<{ id: CanvasProjectTemplateId; titleKey: string }> = [
    { id: "blank", titleKey: "canvas.templates.blank" },
    { id: "storyboard", titleKey: "canvas.templates.storyboard" },
    { id: "campaign", titleKey: "canvas.templates.campaign" },
];

export function buildCanvasTemplateNodes(templateId: CanvasProjectTemplateId, createId: () => string): CanvasNodeData[] {
    if (templateId === "blank") return [];
    const specs =
        templateId === "storyboard"
            ? ([
                  [CanvasNodeType.Text, "Story premise", 0, 0],
                  [CanvasNodeType.Image, "Opening shot", 420, 0],
                  [CanvasNodeType.Video, "Motion shot", 840, 0],
              ] as const)
            : ([
                  [CanvasNodeType.Text, "Campaign brief", 0, 0],
                  [CanvasNodeType.Config, "Visual direction", 400, 0],
                  [CanvasNodeType.Image, "Key visual", 800, 0],
              ] as const);
    return specs.map(([type, title, x, y]) => ({
        id: createId(),
        type,
        title,
        position: { x, y },
        width: type === CanvasNodeType.Text ? 320 : 360,
        height: type === CanvasNodeType.Text ? 220 : 300,
        metadata: type === CanvasNodeType.Text ? { content: "", status: "idle" } : { status: "idle" },
    }));
}
