import { beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({
    media: vi.fn(),
    text: vi.fn(),
    images: vi.fn(),
    mediaRef: vi.fn(),
}));
vi.mock("./cloud-platform", () => ({ cloudModeEnabled: true }));
vi.mock("./cloud-canvas-generation", () => ({ runCloudMediaGeneration: cloud.media, runCloudTextGeneration: cloud.text }));
vi.mock("./cloud-reference-assets", () => ({ uploadCloudReferenceImages: cloud.images, uploadCloudMediaReference: cloud.mediaRef }));
vi.mock("./api/image", () => ({ requestEdit: vi.fn(), requestGeneration: vi.fn(), requestImageQuestion: vi.fn() }));
vi.mock("./api/audio", () => ({ requestAudioGeneration: vi.fn() }));
vi.mock("./api/video", () => ({ requestVideoGeneration: vi.fn() }));

import { generateCanvasImage, generateCanvasText, generateCanvasVideo, generationConfigReady } from "./canvas-generation-provider";

const config = { model: "local-model", size: "1:1", quality: "high", videoSeconds: "6", vquality: "720", videoGenerateAudio: "true", videoWatermark: "false", reasoningEffort: "medium" } as never;

describe("Canvas Cloud generation provider", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cloud.images.mockResolvedValue([{ assetId: "image-1" }]);
        cloud.mediaRef.mockResolvedValue({ assetId: "media-1" });
        cloud.media.mockResolvedValue([new Blob(["result"])]);
        cloud.text.mockResolvedValue("answer");
    });

    it("[GEN-002] uses Server mode readiness and sends image/mask AssetRefs", async () => {
        expect(generationConfigReady(false)).toBe(true);
        const reference = { id: "r1", name: "r.png", type: "image/png", dataUrl: "data:image/png;base64,AQID" };
        await generateCanvasImage(config, "edit", [reference], { workspaceId: "w1" }, { ...reference, id: "mask" });
        expect(cloud.media).toHaveBeenCalledWith(expect.objectContaining({ parameters: expect.objectContaining({ images: [{ assetId: "image-1" }], mask: { assetId: "image-1" } }) }));
    });

    it("[GEN-003] transports image, video and audio references for video generation", async () => {
        await generateCanvasVideo(config, "animate", { images: [], videos: [{ id: "v", name: "v.mp4", type: "video/mp4", url: "blob:v" }], audios: [{ id: "a", name: "a.mp3", type: "audio/mpeg", url: "blob:a" }] }, { workspaceId: "w1" });
        expect(cloud.media).toHaveBeenCalledWith(expect.objectContaining({ parameters: expect.objectContaining({ videos: [{ assetId: "media-1" }], audios: [{ assetId: "media-1" }] }) }));
    });

    it("[GEN-001] keeps AssetRefs nested until Worker materialization for multimodal text", async () => {
        await generateCanvasText(config, "inspect", [], [{ id: "r", name: "r.png", type: "image/png", dataUrl: "data:image/png;base64,AQID" }], vi.fn(), { workspaceId: "w1" });
        expect(cloud.text).toHaveBeenCalledWith(expect.objectContaining({ parameters: expect.objectContaining({ messages: [{ role: "user", content: [expect.anything(), { type: "image_url", image_url: { url: { assetId: "image-1" } } }] }] }) }));
    });
});
