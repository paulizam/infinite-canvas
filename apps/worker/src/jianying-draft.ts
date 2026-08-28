import {
  AudioMaterial,
  AudioSegment,
  ClipSettings,
  DraftFolder,
  TextSegment,
  TextStyle,
  TrackType,
  VideoMaterial,
  VideoSegment,
  trange,
} from "jsjianyingdraft";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { DramaRenderJob } from "./drama-render-types.js";
import { deterministicZip } from "./deterministic-zip.js";

const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
type Asset = { assetId: string; name: string; mimeType: string; bytes: Uint8Array };

export async function buildJianyingDraft(job: DramaRenderJob, assets: Asset[]) {
  const version = versionOf(job.input.settings);
  if (assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) > MAX_MEDIA_BYTES)
    throw new Error("Jianying package media exceeds 200 MiB");
  const root = await mkdtemp(join(tmpdir(), "ic-jianying-"));
  try {
    const draftName = safeName(String(job.input.settings.draftName || job.projectId));
    const drafts = join(root, "drafts");
    await mkdir(drafts, { recursive: true });
    const width = dimension(job.input.settings.width, 1080);
    const height = dimension(job.input.settings.height, 1920);
    const script = new DraftFolder(drafts).createDraft(draftName, width, height, {
      fps: dimension(job.input.settings.fps, 30),
      allowReplace: true,
    });
    const draftDir = join(drafts, draftName);
    const assetsDir = join(draftDir, "assets");
    await mkdir(assetsDir, { recursive: true });
    const byId = new Map<string, { asset: Asset; path: string }>();
    for (const [index, asset] of assets.entries()) {
      const name = safeAssetName(asset.name, index);
      const path = join(assetsDir, name);
      await writeFile(path, asset.bytes);
      byId.set(asset.assetId, { asset, path });
    }

    const manifest = job.input.materials || legacyManifest(assets);
    const visual = manifest.filter((item) => item.kind !== "audio").sort((a, b) => a.sortOrder - b.sortOrder);
    const audio = manifest.filter((item) => item.kind === "audio").sort((a, b) => a.startMs - b.startMs);
    const subtitles = job.input.timeline.flatMap(subtitle);
    if (visual.length) script.addTrack(TrackType.video);
    if (audio.length) script.addTrack(TrackType.audio, "配音");
    if (subtitles.length) script.addTrack(TrackType.text, "字幕");

    let offsetUs = 0;
    for (const item of visual) {
      const file = byId.get(item.assetId);
      if (!file) throw new Error(`Jianying material is missing: ${item.assetId}`);
      const durationUs = Math.max(1, item.durationMs) * 1000;
      script.addSegment(
        new VideoSegment(
          new VideoMaterial(file.path, { duration: durationUs, width, height }),
          trange(offsetUs, durationUs),
        ),
      );
      offsetUs += durationUs;
    }
    for (const item of audio) {
      const file = byId.get(item.assetId);
      if (!file) throw new Error(`Jianying material is missing: ${item.assetId}`);
      const durationUs = Math.max(1, item.durationMs) * 1000;
      script.addSegment(
        new AudioSegment(new AudioMaterial(file.path, { duration: durationUs }), trange(item.startMs * 1000, durationUs)),
        "配音",
      );
    }
    const style = new TextStyle({ size: height > width ? 12 : 8, color: [1, 1, 1], align: 1, bold: true, autoWrapping: true });
    const clipSettings = new ClipSettings({ transformY: height > width ? -0.75 : -0.8 });
    for (const item of subtitles)
      script.addSegment(new TextSegment(item.text, trange(item.startMs * 1000, (item.endMs - item.startMs) * 1000), { style, clipSettings }), "字幕");
    script.save();
    const contentPath = join(draftDir, "draft_content.json");
    const targetAssets = targetAssetsPath(job.input.settings.draftPath, draftName);
    await rewriteMaterialPaths(
      contentPath,
      assetsDir,
      targetAssets,
    );
    await rewriteMaterialPaths(
      join(draftDir, "draft_meta_info.json"),
      draftDir,
      targetAssets === "assets" ? "." : targetAssets.replace(/\/assets$/, ""),
    );
    if (version === "6") await rename(contentPath, join(draftDir, "draft_info.json"));
    return deterministicZip(await entries(draftDir, draftName));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function legacyManifest(assets: Asset[]) {
  return assets.map((asset, sortOrder) => ({ assetId: asset.assetId, kind: asset.mimeType.startsWith("audio/") ? "audio" as const : asset.mimeType.startsWith("image/") ? "image" as const : "video" as const, shotId: null, startMs: 0, durationMs: 3000, sortOrder }));
}
function subtitle(value: unknown) {
  const item = record(value);
  if (item?.kind !== "subtitle" || typeof item.textContent !== "string") return [];
  const startMs = Number(item.startMs), endMs = Number(item.endMs);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? [{ text: item.textContent, startMs, endMs }]
    : [];
}
async function entries(directory: string, draftName: string) {
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push({ name: `${draftName}/${relative(directory, path).replaceAll("\\", "/")}`, bytes: new Uint8Array(await readFile(path)) });
    }
  };
  await walk(directory);
  return files;
}
async function rewriteMaterialPaths(jsonPath: string, from: string, to: string) {
  const source = JSON.parse(await readFile(jsonPath, "utf8")) as unknown;
  const replace = (value: unknown): unknown => {
    if (typeof value === "string")
      return value.includes(from) ? value.replaceAll(from, to) : value;
    if (Array.isArray(value)) return value.map(replace);
    const object = record(value);
    return object
      ? Object.fromEntries(Object.entries(object).map(([key, item]) => [key, replace(item)]))
      : value;
  };
  await writeFile(jsonPath, JSON.stringify(replace(source)), "utf8");
}
function targetAssetsPath(value: unknown, draftName: string) {
  if (value === undefined || value === null || value === "") return "assets";
  if (typeof value !== "string") throw new Error("Jianying draftPath must be an absolute path");
  const path = value.trim();
  if (
    !path ||
    path.length > 1024 ||
    /[\u0000-\u001f]/.test(path) ||
    (!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("/"))
  )
    throw new Error("Jianying draftPath must be an absolute path");
  return `${path.replace(/[\\/]+$/, "")}/${draftName}/assets`;
}
function versionOf(settings: Record<string, unknown>) {
  const value = settings.jianyingVersion ?? settings.version ?? "6";
  if (value !== "5" && value !== "6") throw new Error("Jianying version must be 5 or 6");
  return value;
}
function dimension(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 8192) throw new Error("Jianying dimension or fps is invalid");
  return parsed;
}
function safeName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.\.+/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "InfiniteCanvas";
}
function safeAssetName(value: string, index: number) {
  const name = value.replaceAll("\\", "/").split("/").at(-1)?.trim() || "";
  return name.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+$/, "") || `media-${index}`;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
