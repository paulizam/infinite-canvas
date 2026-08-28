import { describe, expect, it, vi } from "vitest";
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { analyzeCanvasNodeRelationships, applyCanvasAgentOps, partitionCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

const snapshot: CanvasAgentSnapshot = {
    projectId: "project",
    title: "Agent canvas",
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
    nodes: ["source", "config", "target"].map((id) => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} })),
    connections: [
        { id: "one", fromNodeId: "source", toNodeId: "config" },
        { id: "two", fromNodeId: "config", toNodeId: "target" },
    ],
};

describe("Canvas Agent Run contracts [CAN-016]", () => {
    it("analyzes transitive relationships around a target node", () => {
        expect(analyzeCanvasNodeRelationships("target", snapshot.nodes, snapshot.connections)).toEqual({ nodeId: "target", upstreamNodeIds: ["config", "source"], downstreamNodeIds: [], connectionIds: ["two"] });
    });

    it("separates execution requests and writes Agent results back to target nodes", () => {
        const ops = [
            { type: "update_node", id: "target", metadata: { content: "agent result", status: "success" } },
            { type: "run_generation", nodeId: "target", mode: "image", prompt: "render result" },
        ] as const;
        const plan = partitionCanvasAgentOps([...ops]);
        expect(plan.mutations).toHaveLength(1);
        expect(plan.generations).toEqual([ops[1]]);
        expect(applyCanvasAgentOps(snapshot, plan.mutations).nodes.find((node) => node.id === "target")?.metadata).toMatchObject({ content: "agent result", status: "success" });
    });
});
