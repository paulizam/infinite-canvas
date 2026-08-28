import { describe, expect, it, vi } from "vitest";

import type { CloudPlatformClient } from "@/services/cloud-platform";
import type { AgentCanvasContext } from "@/stores/use-agent-store";
import { applyAgentCanvasResult, deliverAgentAssetToDrama, type AgentRunResult } from "./agent-result-delivery";

describe("[CAN-016][AGT-007] Agent result delivery", () => {
    it("applies pending Canvas operations but never duplicates server-applied tool results", () => {
        const applyOps = vi.fn();
        const canvas = { applyOps } as unknown as AgentCanvasContext;
        const pending = { id: "pending", kind: "canvas_operation", payload: { ops: [{ type: "update_node", id: "target", title: "Done" }] }, assetId: null };
        expect(applyAgentCanvasResult(pending, canvas)).toBe("applied");
        expect(applyOps).toHaveBeenCalledOnce();

        const completed = { ...pending, id: "completed", payload: { ...pending.payload, revision: 7 } };
        expect(applyAgentCanvasResult(completed, canvas)).toBe("already_applied");
        expect(applyOps).toHaveBeenCalledOnce();
    });

    it("delivers an Asset-backed result into a Drama entity with revision and idempotency guards", async () => {
        const importDramaFromAsset = vi.fn().mockResolvedValue({ project: { revision: 4 } });
        const client = { importDramaFromAsset } as unknown as CloudPlatformClient;
        const result = { id: "result", kind: "image", payload: {}, assetId: "11111111-1111-4111-8111-111111111111" } as AgentRunResult;
        await deliverAgentAssetToDrama(client, result, { dramaId: "drama-1", expectedDramaRevision: 3, target: { type: "entity", kind: "prop", name: "Poster", sortOrder: 2 } }, "agent-delivery-123");
        expect(importDramaFromAsset).toHaveBeenCalledWith("drama-1", {
            assetId: result.assetId,
            expectedDramaRevision: 3,
            mutationId: "agent-delivery-123",
            target: { type: "entity", kind: "prop", name: "Poster", sortOrder: 2 },
        });
    });
});
