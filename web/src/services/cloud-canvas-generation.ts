import type { GenerationCapability } from "@infinite-canvas/contracts";
import { nanoid } from "nanoid";

import { resolveLogicalModel } from "./cloud-billing-preview";
import { createAndWaitForGeneration, generationAssets, generationText } from "./cloud-generation";
import { cloudPlatform } from "./cloud-platform";
import type { CloudPlatformClient } from "./cloud-platform";

type CloudCanvasRequest = {
    workspaceId: string;
    capability: Exclude<GenerationCapability, "agent">;
    requestedModel: string;
    parameters: Record<string, unknown>;
    signal?: AbortSignal;
    client?: CloudPlatformClient;
};

export async function runCloudCanvasGeneration(request: CloudCanvasRequest) {
    const client = request.client || cloudPlatform;
    const models = await client.listModels();
    const logicalModel = resolveLogicalModel(models, request.capability, request.requestedModel);
    if (!logicalModel) throw new Error("No enabled Cloud model is available for this capability");
    return createAndWaitForGeneration(
        client,
        {
            workspaceId: request.workspaceId,
            capability: request.capability,
            logicalModelId: logicalModel.id,
            clientRequestId: nanoid(),
            parameters: request.parameters,
        },
        { signal: request.signal },
    );
}

export async function runCloudTextGeneration(request: CloudCanvasRequest) {
    const job = await runCloudCanvasGeneration(request);
    const text = generationText(job);
    if (!text) throw new Error("Cloud text model returned no text");
    return text;
}

export async function runCloudMediaGeneration(request: CloudCanvasRequest) {
    const job = await runCloudCanvasGeneration(request);
    const assets = generationAssets(job);
    if (!assets.length) throw new Error(`Cloud ${request.capability} model returned no assets`);
    const client = request.client || cloudPlatform;
    return Promise.all(assets.map((asset) => client.downloadAsset(asset.assetId, request.signal)));
}
