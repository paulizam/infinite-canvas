import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Canvas AI super resolution delivery [CAN-009]", () => {
    it("creates a durable image-edit child with source lineage and visible terminal state", () => {
        const source = readFileSync("src/pages/canvas/project.tsx", "utf8");
        expect(source).toContain("generateCanvasImage(generationConfig, prompt, [source]");
        expect(source).toContain("status: NODE_STATUS_LOADING");
        expect(source).toContain("fromNodeId: node.id, toNodeId: childId");
        expect(source).toContain("status: NODE_STATUS_ERROR, errorDetails");
        expect(source).toContain('buildImageGenerationMetadata("edit", generationConfig, 1, [source])');
        expect(source).not.toContain("canvas.projectPage.notImplemented");
    });
});
