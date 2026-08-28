import { describe, expect, it } from "vitest";
import { buildDramaRenderSettings } from "./render-settings";

describe("Drama render settings", () => {
    it("[DRM-008] builds discoverable Jianying v5/v6 settings", () => {
        expect(buildDramaRenderSettings("jianying", { fps: 30, width: 1080, height: 1920, jianyingVersion: "6", draftPath: "C:\\Jianying\\Drafts" }, { custom: true, fps: 1 })).toEqual({
            custom: true,
            fps: 30,
            width: 1080,
            height: 1920,
            jianyingVersion: "6",
            draftPath: "C:\\Jianying\\Drafts",
        });
    });
    it("[DRM-007] keeps advanced FFmpeg settings with validated fps", () => {
        expect(buildDramaRenderSettings("ffmpeg", { fps: 24 }, { codec: "libx264" })).toEqual({ codec: "libx264", fps: 24 });
    });
    it("rejects unsafe paths, versions, and dimensions", () => {
        expect(() => buildDramaRenderSettings("jianying", { fps: 30, width: 1080, height: 1920, jianyingVersion: "7" }, {})).toThrow(/version/);
        expect(() => buildDramaRenderSettings("jianying", { fps: 30, width: 1080, height: 1920, jianyingVersion: "6", draftPath: "relative/path" }, {})).toThrow(/absolute/);
        expect(() => buildDramaRenderSettings("ffmpeg", { fps: 0 }, {})).toThrow(/fps/);
    });
});
