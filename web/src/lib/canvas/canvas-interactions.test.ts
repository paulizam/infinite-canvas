import { describe, expect, it } from "vitest";
import { buildPastedCanvas, selectNodesInRect, zoomViewportAround } from "@/lib/canvas/canvas-interactions";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const makeNode = (id: string, x: number, y: number, groupId?: string): CanvasNodeData => ({ id, type: groupId ? CanvasNodeType.Image : CanvasNodeType.Group, title: id, position: { x, y }, width: 100, height: 80, metadata: groupId ? { groupId, content: `blob:${id}` } : {} });

describe("canvas viewport, selection, and clipboard contracts [CAN-002] [CAN-003]", () => {
    it("clamps zoom while keeping the viewport center world coordinate stable", () => {
        expect(zoomViewportAround({ x: 100, y: 50, k: 2 }, { width: 800, height: 600 }, 20)).toEqual({ x: -350, y: -325, k: 5 });
        expect(zoomViewportAround({ x: 400, y: 300, k: 1 }, { width: 800, height: 600 }, 0)).toEqual({ x: 400, y: 300, k: 0.05 });
    });

    it("uses intersection selection and preserves additive selections", () => {
        const nodes = [makeNode("a", 0, 0), makeNode("b", 150, 150), makeNode("c", 400, 400)];
        expect([...selectNodesInRect(nodes, { x: 200, y: 200 }, { x: 50, y: 50 }, ["c"])]).toEqual(["c", "a", "b"]);
        expect([...selectNodesInRect(nodes, { x: 100, y: 0 }, { x: 120, y: 80 })]).toEqual([]);
    });

    it("recenters pasted nodes and remaps group membership and internal connections", () => {
        const result = buildPastedCanvas({ nodes: [makeNode("group", 0, 0), makeNode("child", 20, 20, "group")], connections: [{ id: "edge", fromNodeId: "group", toNodeId: "child" }, { id: "external", fromNodeId: "child", toNodeId: "outside" }] }, { x: 500, y: 400 }, (kind, index) => `${kind}-${index}`);
        expect(result.nodes.map((node) => ({ id: node.id, groupId: node.metadata?.groupId, position: node.position }))).toEqual([{ id: "node-0", groupId: undefined, position: { x: 440, y: 350 } }, { id: "node-1", groupId: "node-0", position: { x: 460, y: 370 } }]);
        expect(result.connections).toEqual([{ id: "connection-0", fromNodeId: "node-0", toNodeId: "node-1" }]);
    });
});
