import type { BillingEstimate, BillingWallet, GenerationCapability, LogicalModel } from "@infinite-canvas/contracts";

import type { CloudPlatformClient } from "./cloud-platform";

export type CloudBillingPreviewState =
    | {
          status: "idle" | "loading";
          estimate: BillingEstimate | null;
          wallet: BillingWallet | null;
          logicalModel: LogicalModel | null;
          error: null;
      }
    | { status: "ready"; estimate: BillingEstimate; wallet: BillingWallet; logicalModel: LogicalModel; error: null }
    | { status: "error"; estimate: null; wallet: null; logicalModel: null; error: string };

export class CloudBillingPreviewController {
    private revision = 0;

    constructor(
        private readonly client: CloudPlatformClient,
        private readonly enabled: boolean,
        private readonly publish: (state: CloudBillingPreviewState) => void,
    ) {}

    async refresh(requestedModel: string, capability: GenerationCapability, parameters: Record<string, unknown>) {
        const revision = ++this.revision;
        if (!this.enabled) {
            this.publish(idleState);
            return;
        }
        this.publish({ status: "loading", estimate: null, wallet: null, logicalModel: null, error: null });
        try {
            const [models, wallet] = await Promise.all([this.client.listModels(), this.client.getBillingWallet()]);
            const logicalModel = resolveLogicalModel(models, capability, requestedModel);
            if (!logicalModel) throw new Error("No enabled logical model is available for this capability");
            const estimate = await this.client.estimateGeneration(logicalModel.id, capability, parameters);
            if (revision !== this.revision) return;
            this.publish({ status: "ready", estimate, wallet, logicalModel, error: null });
        } catch (error) {
            if (revision !== this.revision) return;
            this.publish({
                status: "error",
                estimate: null,
                wallet: null,
                logicalModel: null,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    dispose() {
        this.revision += 1;
    }
}

export function resolveLogicalModel(models: LogicalModel[], capability: GenerationCapability, requestedModel: string) {
    const candidates = models.filter((model) => model.enabled && model.capability === capability);
    return (
        candidates.find((model) => model.id === requestedModel || model.name === requestedModel) ||
        candidates.find((model) => model.isDefault) ||
        candidates[0] ||
        null
    );
}

export function generationBillingParameters(config: { count: string; size: string; videoSeconds: string }) {
    return {
        count: Math.max(1, Math.floor(Number(config.count) || 1)),
        resolution: config.size,
        durationSeconds: Math.max(0, Number(config.videoSeconds) || 0),
    };
}

const idleState: CloudBillingPreviewState = {
    status: "idle",
    estimate: null,
    wallet: null,
    logicalModel: null,
    error: null,
};
