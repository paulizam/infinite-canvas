import { describe, expect, it } from "vitest";

import { buildSplitCuts, MAX_UPSCALE_LONG_EDGE, resolveCropPixels, resolveUpscaleSize } from "@/lib/canvas/canvas-image-data";
import { resolveVideoFrameTime } from "@/lib/canvas/canvas-video-frame";

describe("canvas media geometry contracts [CAN-009]", () => {
    it("resolves centered and bounded crop rectangles", () => {
        expect(resolveCropPixels(1200, 800)).toEqual({ x: 200, y: 0, width: 800, height: 800 });
        expect(resolveCropPixels(1000, 500, { x: -0.2, y: 0.25, width: 1.5, height: 1 })).toEqual({ x: 0, y: 125, width: 1000, height: 375 });
        expect(resolveCropPixels(100, 100, { x: 0.99, y: 0.99, width: 0, height: 0 })).toEqual({ x: 99, y: 99, width: 1, height: 1 });
    });

    it("builds ordered, unique split cuts and prevents zero-sized pieces", () => {
        expect(buildSplitCuts(undefined, 10, 3)).toEqual([0, 3, 6, 10]);
        expect(buildSplitCuts([0.5, 0.5, -1, 2, 0.25], 100, 4)).toEqual([0, 25, 50, 100]);
        expect(buildSplitCuts(undefined, 2, 20)).toEqual([0, 1, 2]);
    });

    it("preserves aspect ratio within upscale and video-frame bounds", () => {
        expect(resolveUpscaleSize(2000, 1000, 4000)).toEqual({ width: 4000, height: 2000 });
        expect(resolveUpscaleSize(2000, 1000, 9000)).toEqual({ width: MAX_UPSCALE_LONG_EDGE, height: MAX_UPSCALE_LONG_EDGE / 2 });
        expect(resolveUpscaleSize(Number.NaN, 0, Number.POSITIVE_INFINITY)).toEqual({ width: 1, height: 1 });
        expect(resolveVideoFrameTime("first", 10, 5)).toBe(0);
        expect(resolveVideoFrameTime("last", 10, 5)).toBeCloseTo(9.999);
        expect(resolveVideoFrameTime("current", 10, -4)).toBe(0);
        expect(resolveVideoFrameTime("current", 10, 99)).toBeCloseTo(9.999);
        expect(resolveVideoFrameTime("current", Number.NaN, Number.NaN)).toBe(0);
    });
});
