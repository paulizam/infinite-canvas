import type { GenerationCapability } from "@infinite-canvas/contracts";
import { useEffect, useMemo, useState } from "react";

import {
    CloudBillingPreviewController,
    generationBillingParameters,
    type CloudBillingPreviewState,
} from "@/services/cloud-billing-preview";
import { cloudModeEnabled, cloudPlatform } from "@/services/cloud-platform";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";
import type { AiConfig } from "@/stores/use-config-store";

const idleState: CloudBillingPreviewState = {
    status: "idle",
    estimate: null,
    wallet: null,
    logicalModel: null,
    error: null,
};

export function useCloudBillingPreview(
    model: string,
    capability: GenerationCapability,
    config: Pick<AiConfig, "count" | "size" | "videoSeconds">,
) {
    const authenticated = useCloudSessionStore((state) => state.status === "authenticated");
    const [state, setState] = useState<CloudBillingPreviewState>(idleState);
    const parameters = useMemo(
        () => generationBillingParameters(config),
        [config.count, config.size, config.videoSeconds],
    );

    useEffect(() => {
        const enabled = cloudModeEnabled && authenticated;
        const controller = new CloudBillingPreviewController(cloudPlatform, enabled, setState);
        if (!enabled) {
            void controller.refresh(model, capability, parameters);
            return () => controller.dispose();
        }
        const timer = window.setTimeout(() => void controller.refresh(model, capability, parameters), 350);
        return () => {
            window.clearTimeout(timer);
            controller.dispose();
        };
    }, [authenticated, capability, model, parameters]);

    return {
        ...state,
        enabled: cloudModeEnabled && authenticated,
        insufficient: state.status === "ready" && state.wallet.balanceUnits < state.estimate.estimatedUnits,
    };
}
