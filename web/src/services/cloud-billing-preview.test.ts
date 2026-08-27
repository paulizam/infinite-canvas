import type { BillingEstimate, BillingWallet, LogicalModel } from "@infinite-canvas/contracts";
import { describe, expect, it, vi } from "vitest";

import { CloudBillingPreviewController, generationBillingParameters, resolveLogicalModel } from "./cloud-billing-preview";

const imageModel: LogicalModel = { id: "image.default", name: "Image Default", capability: "image", enabled: true, isDefault: true };
const wallet: BillingWallet = { userId: "u1", balanceUnits: 20, updatedAt: "2026-08-28T00:00:00.000Z" };
const estimate: BillingEstimate = { logicalModelId: imageModel.id, capability: "image", estimatedUnits: 8, baseUnits: 4, multiplierPermille: 2000, currency: "points" };

describe("CloudBillingPreviewController", () => {
    it("does not access Cloud APIs while Server mode is disabled", async () => {
        const client = { listModels: vi.fn(), getBillingWallet: vi.fn(), estimateGeneration: vi.fn() };
        const publish = vi.fn();
        await new CloudBillingPreviewController(client as never, false, publish).refresh("local-model", "image", {});
        expect(client.listModels).not.toHaveBeenCalled();
        expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: "idle" }));
    });

    it("publishes the authoritative estimate and wallet", async () => {
        const client = {
            listModels: vi.fn(async () => [imageModel]),
            getBillingWallet: vi.fn(async () => wallet),
            estimateGeneration: vi.fn(async () => estimate),
        };
        const publish = vi.fn();
        await new CloudBillingPreviewController(client as never, true, publish).refresh("unknown-local-name", "image", { count: 2 });
        expect(client.estimateGeneration).toHaveBeenCalledWith("image.default", "image", { count: 2 });
        expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", estimate, wallet, logicalModel: imageModel }));
    });

    it("drops an obsolete response after a newer refresh", async () => {
        let releaseFirst: ((models: LogicalModel[]) => void) | undefined;
        const first = new Promise<LogicalModel[]>((resolve) => (releaseFirst = resolve));
        const client = {
            listModels: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce([imageModel]),
            getBillingWallet: vi.fn(async () => wallet),
            estimateGeneration: vi.fn(async () => estimate),
        };
        const publish = vi.fn();
        const controller = new CloudBillingPreviewController(client as never, true, publish);
        const obsolete = controller.refresh("old", "image", {});
        await controller.refresh("new", "image", {});
        releaseFirst?.([imageModel]);
        await obsolete;
        expect(publish.mock.calls.filter(([state]) => state.status === "ready")).toHaveLength(1);
    });
});

describe("billing preview helpers", () => {
    it("prefers an explicit logical model and otherwise falls back to the capability default", () => {
        const explicit = { ...imageModel, id: "image.pro", isDefault: false };
        expect(resolveLogicalModel([imageModel, explicit], "image", "image.pro")).toEqual(explicit);
        expect(resolveLogicalModel([imageModel, explicit], "image", "missing")).toEqual(imageModel);
    });

    it("normalizes pricing parameters", () => {
        expect(generationBillingParameters({ count: "2.8", size: "1920x1080", videoSeconds: "6" })).toEqual({ count: 2, resolution: "1920x1080", durationSeconds: 6 });
    });
});
