import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { runDramaRenderCycle } from "./drama-render-runtime.js";
import type { DramaRenderJob } from "./drama-render-types.js";
import type { WorkerApiClient } from "./client.js";

const ffmpegPath = process.env.FFMPEG_PATH;
const runtimeIt = ffmpegPath ? it : it.skip;

describe("Drama FFmpeg runtime acceptance", () => {
  runtimeIt(
    "renders sample media through the durable worker lifecycle [DRM-007]",
    async () => {
      const fixtureDir = await mkdtemp(join(tmpdir(), "ic-ffmpeg-fixture-"));
      try {
        const sourcePath = join(fixtureDir, "source.mp4");
        const generated = spawnSync(
          ffmpegPath!,
          [
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x180:d=1:r=24",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            sourcePath,
          ],
          { windowsHide: true, encoding: "utf8" },
        );
        expect(generated.status, generated.stderr).toBe(0);
        const source = await readFile(sourcePath);
        const job: DramaRenderJob = {
          id: "runtime-render-1",
          projectId: "runtime-drama",
          workspaceId: "runtime-workspace",
          ownerId: "runtime-owner",
          kind: "ffmpeg",
          status: "running",
          progress: 0,
          attempt: 1,
          input: {
            assetIds: ["runtime-source"],
            timeline: [{ kind: "video", startMs: 0, endMs: 1000 }],
            settings: {},
          },
          leaseUntil: new Date(Date.now() + 60_000).toISOString(),
          updatedAt: new Date().toISOString(),
        };
        let rendered: Uint8Array | undefined;
        const client = {
          claimDramaRenders: vi.fn(async () => [job]),
          heartbeatDramaRenders: vi.fn(async () => 1),
          readDramaRenderAsset: vi.fn(async () => ({
            mimeType: "video/mp4",
            bytes: source,
          })),
          transitionDramaRender: vi.fn(async () => job),
          persistDramaRenderOutput: vi.fn(
            async (_workerId, _jobId, bytes: Uint8Array, name: string) => {
              rendered = bytes;
              expect(name).toBe("runtime-drama-v1.mp4");
              return { id: "runtime-output" };
            },
          ),
        } as unknown as WorkerApiClient;

        await expect(
          runDramaRenderCycle({
            client,
            workerId: "runtime-worker",
            limit: 1,
            leaseMs: 60_000,
            ffmpegPath,
          }),
        ).resolves.toBe(1);
        expect(rendered?.byteLength).toBeGreaterThan(1_000);
        expect(Buffer.from(rendered!).includes(Buffer.from("ftyp"))).toBe(true);
        expect(
          vi.mocked(client.transitionDramaRender).mock.calls.at(-1)?.slice(2),
        ).toEqual([
          "succeeded",
          { progress: 100, outputAssetId: "runtime-output" },
          undefined,
        ]);
      } finally {
        await rm(fixtureDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
