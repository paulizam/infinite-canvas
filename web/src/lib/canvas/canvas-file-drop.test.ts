import { describe, expect, it } from "vitest";

import { classifyCanvasFile, planCanvasFileDrops } from "@/lib/canvas/canvas-file-drop";

describe("canvas file drop contracts [CAN-007]", () => {
    it("classifies supported image, video, audio, and text MIME types", () => {
        expect(classifyCanvasFile({ name: "shot.bin", type: "image/png" })).toBe("image");
        expect(classifyCanvasFile({ name: "take.bin", type: "video/mp4" })).toBe("video");
        expect(classifyCanvasFile({ name: "voice.bin", type: "audio/mpeg" })).toBe("audio");
        expect(classifyCanvasFile({ name: "script.bin", type: "text/plain" })).toBe("text");
        expect(classifyCanvasFile({ name: "story.json", type: "application/json" })).toBe("text");
    });

    it("uses file extensions only for missing or generic MIME metadata", () => {
        expect(classifyCanvasFile({ name: "FRAME.WEBP", type: "" })).toBe("image");
        expect(classifyCanvasFile({ name: "clip.mov", type: "application/octet-stream" })).toBe("video");
        expect(classifyCanvasFile({ name: "music.flac", type: "" })).toBe("audio");
        expect(classifyCanvasFile({ name: "notes.md", type: "" })).toBe("text");
        expect(classifyCanvasFile({ name: "spoofed.png", type: "application/pdf" })).toBeNull();
        expect(classifyCanvasFile({ name: "archive.zip", type: "" })).toBeNull();
    });

    it("filters unsupported files before applying deterministic stagger positions", () => {
        const plans = planCanvasFileDrops(
            [
                { name: "one.png", type: "image/png" },
                { name: "ignored.pdf", type: "application/pdf" },
                { name: "two.mp3", type: "audio/mpeg" },
                { name: "three.txt", type: "text/plain" },
            ],
            { x: 120, y: -20 },
        );

        expect(plans.map(({ file, kind, position }) => ({ name: file.name, kind, position }))).toEqual([
            { name: "one.png", kind: "image", position: { x: 120, y: -20 } },
            { name: "two.mp3", kind: "audio", position: { x: 160, y: 20 } },
            { name: "three.txt", kind: "text", position: { x: 200, y: 60 } },
        ]);
        expect(() => planCanvasFileDrops([], { x: 0, y: 0 }, -1)).toThrow(/stagger/);
    });
});
