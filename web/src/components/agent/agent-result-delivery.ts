import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CloudAgentRunDetail, CloudDramaTransferTarget, CloudPlatformClient } from "@/services/cloud-platform";
import type { AgentCanvasContext } from "@/stores/use-agent-store";

export type AgentRunResult = CloudAgentRunDetail["results"][number];

export function applyAgentCanvasResult(result: AgentRunResult, canvas: AgentCanvasContext) {
    if (result.kind !== "canvas_operation" || !Array.isArray(result.payload.ops)) throw new Error("Agent result does not contain Canvas operations");
    if (Number.isInteger(result.payload.revision)) return "already_applied" as const;
    canvas.applyOps(result.payload.ops as CanvasAgentOp[]);
    return "applied" as const;
}

export async function deliverAgentAssetToDrama(client: CloudPlatformClient, result: AgentRunResult, input: { dramaId: string; expectedDramaRevision: number; target: CloudDramaTransferTarget }, mutationId: string = crypto.randomUUID()) {
    if (!result.assetId) throw new Error("Agent result is not backed by an Asset");
    return client.importDramaFromAsset(input.dramaId, { assetId: result.assetId, expectedDramaRevision: input.expectedDramaRevision, mutationId, target: input.target });
}
