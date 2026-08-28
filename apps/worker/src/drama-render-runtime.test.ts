import { describe, expect, it, vi } from "vitest";
import {
  buildFfmpegArgs,
  buildJianyingPackage,
  runDramaRenderCycle,
} from "./drama-render-runtime.js";
import { deterministicZip } from "./deterministic-zip.js";
import type { DramaRenderJob } from "./drama-render-types.js";
import type { WorkerApiClient } from "./client.js";

const renderJob = (kind: DramaRenderJob["kind"]): DramaRenderJob => ({
  id: `render-${kind}`,
  projectId: "drama-1",
  workspaceId: "workspace-1",
  ownerId: "owner-1",
  kind,
  status: "running",
  progress: 0,
  attempt: 1,
  input: {
    assetIds: ["asset-1"],
    timeline: [{ kind: "video", startMs: 0, endMs: 1000 }],
    settings: {},
  },
  leaseUntil: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function clientFor(job: DramaRenderJob) {
  return {
    claimDramaRenders: vi.fn(async () => [job]),
    heartbeatDramaRenders: vi.fn(async () => 1),
    readDramaRenderAsset: vi.fn(async () => ({
      mimeType: "video/mp4",
      bytes: Buffer.from("video"),
    })),
    transitionDramaRender: vi.fn(async () => job),
    persistDramaRenderOutput: vi.fn(async () => ({ id: "output-asset" })),
  } as unknown as WorkerApiClient;
}
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
    expect(Buffer.from(zip).includes(Buffer.from("draft_info.json"))).toBe(
      true,
    );
    expect(
      Buffer.from(zip).includes(Buffer.from("materials/media-0.mp4")),
    ).toBe(true);
    expect(Buffer.from(zip).includes(Buffer.from("format_version"))).toBe(true);
  });
  it("[DRM-008] emits Jianying 5 naming and rejects unsafe version values", () => {
    const job = renderJob("jianying");
    job.input.settings = { jianyingVersion: "5" };
    const zip = buildJianyingPackage(job, [
      { name: "../segment.mp4", bytes: Buffer.from("video") },
    ]);
    expect(Buffer.from(zip).includes(Buffer.from("draft_content.json"))).toBe(true);
    expect(Buffer.from(zip).includes(Buffer.from("materials/segment.mp4"))).toBe(true);
    job.input.settings = { jianyingVersion: "7" };
    expect(() => buildJianyingPackage(job, [])).toThrow(/must be 5 or 6/);
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

  it("runs the Jianying worker lifecycle through persisted output", async () => {
    const client = clientFor(renderJob("jianying"));
    await expect(
      runDramaRenderCycle({
        client,
        workerId: "worker-1",
        limit: 1,
        leaseMs: 60_000,
      }),
    ).resolves.toBe(1);
    expect(client.persistDramaRenderOutput).toHaveBeenCalledWith(
      "worker-1",
      "render-jianying",
      expect.any(Uint8Array),
      "drama-1-jianying.zip",
      undefined,
    );
    expect(
      vi
        .mocked(client.transitionDramaRender)
        .mock.calls.map((call) => [call[2], call[3]]),
    ).toEqual([
      ["running", { progress: 5 }],
      ["running", { progress: 35 }],
      ["running", { progress: 90 }],
      ["succeeded", { progress: 100, outputAssetId: "output-asset" }],
    ]);
  });

  it("persists a sanitized failure when FFmpeg cannot start", async () => {
    const client = clientFor(renderJob("ffmpeg"));
    await runDramaRenderCycle({
      client,
      workerId: "worker-1",
      limit: 1,
      leaseMs: 60_000,
      ffmpegPath: "Z:\\missing-private\\ffmpeg.exe",
    });
    const failure = vi.mocked(client.transitionDramaRender).mock.calls.at(-1);
    expect(failure?.[2]).toBe("failed");
    expect(failure?.[3]).toMatchObject({ errorCode: "DRAMA_RENDER_FAILED" });
    expect(JSON.stringify(failure?.[3])).not.toContain("missing-private");
    expect(client.persistDramaRenderOutput).not.toHaveBeenCalled();
  });
});
