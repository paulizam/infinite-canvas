import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string, values?: { index?: number }) => values?.index ? `${key} ${values.index}` : key } }));

import { buildImageGenerationMetadata, nextGenerationAttempt } from "@/lib/canvas/canvas-node-factory";
import { buildNodeGenerationContext, buildNodeGenerationInputs } from "@/components/canvas/canvas-node-generation";
import { buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}, groupId?: string): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata: { ...metadata, ...(groupId ? { groupId } : {}) },
});

describe("canvas generation reference contracts [CAN-010] [CAN-011]", () => {
    it("binds connected config inputs, expands groups, and deduplicates resources", () => {
        const nodes = [
            node("target", CanvasNodeType.Image),
            node("config", CanvasNodeType.Config, { composerContent: "@[node:group] @[node:image]" }),
            node("group", CanvasNodeType.Group),
            node("image", CanvasNodeType.Image, { content: "blob:image", storageKey: "image:one", mimeType: "image/png" }, "group"),
            node("text", CanvasNodeType.Text, { content: "keep the lighting" }, "group"),
        ];
        const connections: CanvasConnection[] = [
            { id: "target-config", fromNodeId: "target", toNodeId: "config" },
            { id: "group-config", fromNodeId: "group", toNodeId: "config" },
            { id: "image-config", fromNodeId: "image", toNodeId: "config" },
        ];

        const inputs = buildNodeGenerationInputs("target", nodes, connections);
        expect(inputs.map((input) => input.nodeId)).toEqual(["group", "image"]);
        const context = buildNodeGenerationContext("config", nodes, connections, "Use @[node:group] and @[node:image]");
        expect(context.referenceImages).toHaveLength(1);
        expect(context.referenceImages[0]).toMatchObject({ id: "image", storageKey: "image:one" });
        expect(context.textCount).toBe(1);
        expect(context.prompt).toContain("keep the lighting");

        const mentions = buildNodeMentionReferences(node("consumer", CanvasNodeType.Config), nodes, [
            { id: "group-consumer", fromNodeId: "group", toNodeId: "consumer" },
            { id: "image-consumer", fromNodeId: "image", toNodeId: "consumer" },
        ]);
        expect(mentions.map((reference) => reference.nodeId)).toEqual(["image", "text"]);
    });

    it("snapshots generation settings and increments retry attempts without mutating the snapshot", () => {
        const config = { model: "image-v2", size: "1536x1024", quality: "high", background: "transparent" } as AiConfig;
        const metadata = buildImageGenerationMetadata("edit", config, 2, [
            { id: "one", name: "one.png", type: "image/png", dataUrl: "blob:one", storageKey: "image:stable-one" },
            { id: "two", name: "two.png", type: "image/png", dataUrl: "https://cdn.example/two.png" },
        ]);

        expect(metadata).toMatchObject({ generationType: "edit", model: "image-v2", size: "1536x1024", quality: "high", background: "transparent", count: 2, references: ["image:stable-one", "https://cdn.example/two.png"] });
        expect(nextGenerationAttempt(metadata)).toBe(1);
        expect(nextGenerationAttempt({ ...metadata, attempt: 1 })).toBe(2);
        expect(nextGenerationAttempt({ ...metadata, attempt: 4 })).toBe(5);
        expect(metadata.attempt).toBeUndefined();
    });
});
