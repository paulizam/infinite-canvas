import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { WorkerApiClient } from "./client.js";
import type { DramaRenderJob } from "./drama-render-types.js";
import { deterministicZip } from "./deterministic-zip.js";
export async function runDramaRenderCycle(input: {
  client: WorkerApiClient;
  workerId: string;
  limit: number;
  leaseMs: number;
  ffmpegPath?: string;
  signal?: AbortSignal;
}) {
  const jobs = await input.client.claimDramaRenders(
    input.workerId,
    input.limit,
    input.leaseMs,
    input.signal,
  );
  const timer = setInterval(
    () =>
      void input.client
        .heartbeatDramaRenders(
          input.workerId,
          jobs.map((x) => x.id),
          input.signal,
        )
        .catch(() => undefined),
    Math.max(5000, Math.floor(input.leaseMs / 3)),
  );
  timer.unref?.();
  try {
    await Promise.all(jobs.map((job) => executeDramaRender(job, input)));
  } finally {
    clearInterval(timer);
  }
  return jobs.length;
}
async function executeDramaRender(
  job: DramaRenderJob,
  input: {
    client: WorkerApiClient;
    workerId: string;
    ffmpegPath?: string;
    signal?: AbortSignal;
  },
) {
  const dir = await mkdtemp(join(tmpdir(), "ic-render-"));
  try {
    await input.client.transitionDramaRender(
      input.workerId,
      job.id,
      "running",
      { progress: 5 },
      input.signal,
    );
    const assets = [] as Array<{
      path: string;
      mimeType: string;
      bytes: Uint8Array;
      name: string;
    }>;
    for (let i = 0; i < job.input.assetIds.length; i++) {
      const a = await input.client.readDramaRenderAsset(
          input.workerId,
          job.id,
          job.input.assetIds[i]!,
          input.signal,
        ),
        name = `media-${i}.${extension(a.mimeType)}`,
        path = join(dir, name);
      await writeFile(path, a.bytes);
      assets.push({ path, mimeType: a.mimeType, bytes: a.bytes, name });
    }
    await input.client.transitionDramaRender(
      input.workerId,
      job.id,
      "running",
      { progress: 35 },
      input.signal,
    );
    let bytes: Uint8Array, name: string;
    if (job.kind === "jianying") {
      bytes = buildJianyingPackage(job, assets);
      name = `${job.projectId}-jianying.zip`;
    } else {
      const output = join(dir, "output.mp4"),
        manifest = join(dir, "concat.txt");
      await writeFile(
        manifest,
        assets
          .filter(
            (x) =>
              x.mimeType.startsWith("video/") ||
              x.mimeType.startsWith("image/"),
          )
          .map(
            (x) =>
              `file '${x.name}'${x.mimeType.startsWith("image/") ? "\nduration 3" : ""}`,
          )
          .join("\n"),
      );
      await runFfmpeg(
        input.ffmpegPath || "ffmpeg",
        buildFfmpegArgs(manifest, assets, output),
        input.signal,
      );
      bytes = new Uint8Array(await readFile(output));
      name = `${job.projectId}-v${job.attempt}.mp4`;
    }
    await input.client.transitionDramaRender(
      input.workerId,
      job.id,
      "running",
      { progress: 90 },
      input.signal,
    );
    const asset = await input.client.persistDramaRenderOutput(
      input.workerId,
      job.id,
      bytes,
      name,
      input.signal,
    );
    await input.client.transitionDramaRender(
      input.workerId,
      job.id,
      "succeeded",
      { progress: 100, outputAssetId: asset.id },
      input.signal,
    );
  } catch (error) {
    await input.client
      .transitionDramaRender(
        input.workerId,
        job.id,
        "failed",
        { errorCode: "DRAMA_RENDER_FAILED", errorMessage: safeMessage(error) },
        input.signal,
      )
      .catch(() => undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function buildJianyingPackage(
  job: DramaRenderJob,
  assets: Array<{ name: string; bytes: Uint8Array }>,
) {
  const version = jianyingVersion(job.input.settings);
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  if (totalBytes > 200 * 1024 * 1024)
    throw new Error("Jianying package media exceeds 200 MiB");
  const materials = assets.map((x, i) => ({
    id: job.input.assetIds[i],
    path: `materials/${safePackageName(x.name, i)}`,
  }));
  const content = Buffer.from(
    JSON.stringify(
      {
        format_version: version,
        duration: timelineDuration(job.input.timeline),
        materials,
        tracks: job.input.timeline,
      },
      null,
      2,
    ),
  );
  const meta = Buffer.from(
    JSON.stringify(
      {
        draft_id: job.id,
        project_id: job.projectId,
        created_at: job.updatedAt || job.leaseUntil,
      },
      null,
      2,
    ),
  );
  return deterministicZip([
    {
      name: version === "6" ? "draft_info.json" : "draft_content.json",
      bytes: content,
    },
    { name: "draft_meta_info.json", bytes: meta },
    ...assets.map((x, i) => ({
      name: `materials/${safePackageName(x.name, i)}`,
      bytes: x.bytes,
    })),
  ]);
}
function jianyingVersion(settings: Record<string, unknown>) {
  const value = settings.jianyingVersion ?? settings.version ?? "6";
  if (value !== "5" && value !== "6")
    throw new Error("Jianying version must be 5 or 6");
  return value;
}
function safePackageName(value: string, index: number) {
  const name = value.replaceAll("\\", "/").split("/").at(-1)?.trim() || "";
  const safe = name.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+$/, "");
  return safe || `media-${index}`;
}
export function buildFfmpegArgs(
  manifest: string,
  assets: Array<{ path: string; mimeType: string }>,
  output: string,
) {
  if (
    !assets.some(
      (x) => x.mimeType.startsWith("video/") || x.mimeType.startsWith("image/"),
    )
  )
    throw new Error("DRAMA_RENDER_VISUAL_REQUIRED");
  const audio = assets.find((x) => x.mimeType.startsWith("audio/"));
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    manifest,
    ...(audio ? ["-i", audio.path] : []),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(audio ? ["-c:a", "aac", "-shortest"] : []),
    "-movflags",
    "+faststart",
    output,
  ];
}
function runFfmpeg(executable: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (x) => {
      if (stderr.length < 4000) stderr += String(x);
    });
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      signal?.removeEventListener("abort", abort);
      code === 0
        ? resolve()
        : reject(new Error(`FFMPEG_EXIT_${code}: ${stderr.slice(-1000)}`));
    });
  });
}
function extension(mime: string) {
  return (
    (
      {
        "video/mp4": "mp4",
        "video/webm": "webm",
        "image/png": "png",
        "image/jpeg": "jpg",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/ogg": "ogg",
      } as Record<string, string>
    )[mime] || "bin"
  );
}
function timelineDuration(items: unknown[]) {
  return items.reduce<number>(
    (n, x) =>
      Math.max(
        n,
        typeof x === "object" && x !== null && "endMs" in x
          ? Number((x as any).endMs) || 0
          : 0,
      ),
    0,
  );
}
function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Render failed")
    .replace(/[A-Z]:\\[^\s]+|\/[\w./-]+/g, "[path]")
    .slice(0, 1000);
}
