import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "@/types/canvas";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { getNodeDefinition, getNodeInspector, registerNodeDefinitions, unregisterPluginNodes } = await import("./node-registry");
const { deserializePluginNode, serializePluginNode } = await import("./plugin-node-codec");

const baseNode: CanvasNodeData = { id: "n1", type: "notes:card", title: "Card", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "current" } };

afterEach(() => unregisterPluginNodes("notes"));

describe("plugin node codec [PLG-001]", () => {
    it("migrates an imported envelope and serializes the current schema", () => {
        const Inspector = () => null;
        const Content = () => null;
        const toolbar = () => [];
        registerNodeDefinitions(
            [
                {
                    type: "notes:card",
                    title: "Card",
                    icon: null,
                    defaultSize: { width: 320, height: 180 },
                    Inspector,
                    Content,
                    toolbar,
                    serialization: {
                        schemaVersion: 2,
                        migrate: (data) => ({ content: (data as { text: string }).text }),
                        deserialize: (data) => ({ content: (data as { content: string }).content }),
                        serialize: (node) => ({ content: node.metadata?.content }),
                    },
                },
            ],
            "notes",
        );
        const imported: CanvasNodeData = { ...baseNode, metadata: { __pluginState: { pluginId: "notes", nodeType: "notes:card", schemaVersion: 1, data: { text: "legacy" } } } };
        const migrated = deserializePluginNode(imported);
        expect(migrated.metadata).toMatchObject({ content: "legacy", __pluginState: { schemaVersion: 2, data: { content: "legacy" } } });
        expect(getNodeInspector(imported.type)).toBe(Inspector);
        expect(getNodeDefinition(imported.type)).toMatchObject({ Content, Inspector, toolbar });
        expect(serializePluginNode({ ...migrated, metadata: { ...migrated.metadata, content: "edited" } }).metadata?.__pluginState).toEqual({ pluginId: "notes", nodeType: "notes:card", schemaVersion: 2, data: { content: "edited" } });
    });

    it("preserves unknown plugin state for lossless round-trip", () => {
        const unknown = { ...baseNode, type: "missing:node", metadata: { __pluginState: { pluginId: "missing", nodeType: "missing:node", schemaVersion: 7, data: { custom: [1, 2, 3] } } } } as CanvasNodeData;
        expect(deserializePluginNode(unknown)).toBe(unknown);
        expect(serializePluginNode(unknown)).toBe(unknown);
    });

    it("fails closed on forward-incompatible state without deleting the envelope", () => {
        registerNodeDefinitions([{ type: "notes:card", title: "Card", icon: null, defaultSize: { width: 1, height: 1 }, serialization: { schemaVersion: 1, serialize: () => ({}), deserialize: () => ({}) } }], "notes");
        const future = { ...baseNode, metadata: { __pluginState: { pluginId: "notes", nodeType: "notes:card", schemaVersion: 9, data: { future: true } } } } as CanvasNodeData;
        const result = deserializePluginNode(future);
        expect(result.metadata?.pluginCodecError).toMatch(/高于/);
        expect(result.metadata?.__pluginState).toEqual(future.metadata?.__pluginState);
    });
});
