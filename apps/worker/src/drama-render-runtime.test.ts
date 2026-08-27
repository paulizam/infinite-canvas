import { describe, expect, it } from "vitest";
import {
  buildFfmpegArgs,
  buildJianyingPackage,
} from "./drama-render-runtime.js";
import { deterministicZip } from "./deterministic-zip.js";
import type { DramaRenderJob } from "./drama-render-types.js";
describe("Drama render runtime", () => {
  it("builds byte-identical ZIP packages with canonical order", () => {
    const files = [
      { name: "b.txt", bytes: Buffer.from("B") },
      { name: "a.txt", bytes: Buffer.from("A") },
    ];
    const a = deterministicZip(files),
      b = deterministicZip([...files].reverse());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).readUInt32LE(0)).toBe(0x04034b50);
    expect(Buffer.from(a).includes(Buffer.from("a.txt"))).toBe(true);
  });
  it("creates a Jianying v6 draft containing metadata, tracks, and bundled media", () => {
    const job = {
      id: "render-1",
      projectId: "drama-1",
      kind: "jianying",
      attempt: 1,
      input: {
        assetIds: ["asset-1"],
        timeline: [
          { kind: "subtitle", textContent: "你好", startMs: 0, endMs: 1000 },
        ],
        settings: {},
      },
      leaseUntil: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as DramaRenderJob;
    const zip = buildJianyingPackage(job, [
      { name: "media-0.mp4", bytes: Buffer.from("video") },
    ]);
    expect(Buffer.from(zip).includes(Buffer.from("draft_content.json"))).toBe(
      true,
    );
    expect(
      Buffer.from(zip).includes(Buffer.from("materials/media-0.mp4")),
    ).toBe(true);
    expect(Buffer.from(zip).includes(Buffer.from("format_version"))).toBe(true);
  });
  it("uses an argv-only FFmpeg plan and rejects audio-only renders", () => {
    const args = buildFfmpegArgs(
      "C:/tmp/concat.txt",
      [
        { path: "C:/tmp/video.mp4", mimeType: "video/mp4" },
        { path: "C:/tmp/audio.mp3", mimeType: "audio/mpeg" },
      ],
      "C:/tmp/out.mp4",
    );
    expect(args).toContain("-nostdin");
    expect(args).toContain("libx264");
    expect(args.at(-1)).toBe("C:/tmp/out.mp4");
    expect(() =>
      buildFfmpegArgs(
        "manifest",
        [{ path: "audio", mimeType: "audio/mpeg" }],
        "out",
      ),
    ).toThrow("DRAMA_RENDER_VISUAL_REQUIRED");
  });
});
