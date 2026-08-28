import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatReport, inspectRuntime } from "./runtime-preflight.mjs";

test("reports pending without exposing environment values", () => {
  const report = inspectRuntime({ VOLCENGINE_SANDBOX_ACCESS_KEY_ID: "secret-ak" }, "win32");
  const text = formatReport(report);
  assert.equal(report.ready, false);
  assert.doesNotMatch(text, /secret-ak/);
  assert.match(text, /PENDING GEN-017/);
});

test("validates provider cases and all local runtime paths", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-preflight-"));
  try {
    const cases = join(root, "cases.json"), executable = join(root, "JianyingPro.exe"), ffmpeg = join(root, "ffmpeg.exe"), drafts = join(root, "drafts");
    writeFileSync(cases, JSON.stringify([{ id: "media", adapter: "media-kit", baseUrl: "https://sandbox.example", apiKeyEnv: "MEDIA_KIT_TEST_KEY", capability: "video", upstreamModel: "test", parameters: { operation: "video-enhance", mode: "fast" } }]));
    writeFileSync(executable, ""); writeFileSync(ffmpeg, ""); mkdirSync(drafts);
    const report = inspectRuntime({ PROVIDER_SANDBOX_CASES_FILE: cases, MEDIA_KIT_TEST_KEY: "secret", VOLCENGINE_SANDBOX_BASE_URL: "https://volc.example", VOLCENGINE_SANDBOX_ACCESS_KEY_ID: "ak", VOLCENGINE_SANDBOX_SECRET_ACCESS_KEY: "sk", JIANYING_EXECUTABLE: executable, JIANYING_DRAFT_ROOT: drafts, FFMPEG_PATH: ffmpeg }, "win32");
    assert.equal(report.ready, true);
    assert.deepEqual(report.requirements["GEN-008/GEN-018"].adapters, ["media-kit"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects insecure case URLs and unsafe credential names", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-preflight-"));
  try {
    const cases = join(root, "cases.json");
    writeFileSync(cases, JSON.stringify([{ id: "bad", adapter: "media-kit", baseUrl: "http://sandbox.example", apiKeyEnv: "bad-name", capability: "video", upstreamModel: "test", parameters: {} }]));
    const report = inspectRuntime({ PROVIDER_SANDBOX_CASES_FILE: cases }, "win32");
    assert.equal(report.requirements["GEN-008/GEN-018"].ready, false);
    assert.match(formatReport(report), /must use HTTPS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
