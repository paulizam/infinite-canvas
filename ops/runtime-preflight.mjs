import { existsSync, readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { pathToFileURL } from "node:url";

const adapters = new Set(["openai-compatible", "gemini", "seedance", "stable-diffusion", "media-kit"]);
const capabilities = new Set(["text", "image", "video", "audio"]);

export function inspectRuntime(env = process.env, platform = process.platform) {
  const provider = inspectProviderCases(env);
  const volcengine = inspectVolcengine(env);
  const jianying = inspectJianying(env, platform);
  const checks = [...provider.checks, ...volcengine.checks, ...jianying.checks];
  return {
    ready: checks.every((check) => check.ready),
    requirements: {
      "GEN-008/GEN-018": provider,
      "GEN-017": volcengine,
      "DRM-008": jianying,
    },
  };
}

function inspectProviderCases(env) {
  const checks = [];
  const file = clean(env.PROVIDER_SANDBOX_CASES_FILE);
  checks.push(check("case-file", Boolean(file && existsSync(file)), file ? "configured" : "missing"));
  const cases = [];
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("must be a non-empty array");
      for (const [index, value] of parsed.entries()) cases.push(validateCase(value, index));
      checks.push(check("case-schema", true, `${cases.length} valid case(s)`));
    } catch (error) {
      checks.push(check("case-schema", false, safeError(error)));
    }
  }
  for (const runtimeCase of cases)
    checks.push(check(`credential:${runtimeCase.id}`, Boolean(clean(env[runtimeCase.apiKeyEnv])), `env ${runtimeCase.apiKeyEnv} ${clean(env[runtimeCase.apiKeyEnv]) ? "present" : "missing"}`));
  const names = [...new Set(cases.map((item) => item.adapter))].sort();
  return { ready: checks.every((item) => item.ready), adapters: names, caseCount: cases.length, checks };
}

function inspectVolcengine(env) {
  const names = ["VOLCENGINE_SANDBOX_BASE_URL", "VOLCENGINE_SANDBOX_ACCESS_KEY_ID", "VOLCENGINE_SANDBOX_SECRET_ACCESS_KEY"];
  const checks = names.map((name) => check(name, Boolean(clean(env[name])), clean(env[name]) ? "present" : "missing"));
  const baseUrl = clean(env.VOLCENGINE_SANDBOX_BASE_URL);
  if (baseUrl) checks.push(check("volcengine-https", validHttpsUrl(baseUrl), validHttpsUrl(baseUrl) ? "valid HTTPS URL" : "HTTPS URL required"));
  return { ready: checks.every((item) => item.ready), checks };
}

function inspectJianying(env, platform) {
  const executable = clean(env.JIANYING_EXECUTABLE) || findExecutable(platform === "win32" ? ["JianyingPro.exe", "CapCut.exe"] : [], env.PATH);
  const draftRoot = clean(env.JIANYING_DRAFT_ROOT);
  const ffmpeg = clean(env.FFMPEG_PATH) || findExecutable(platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"], env.PATH);
  const checks = [
    check("windows", platform === "win32", platform === "win32" ? "Windows" : "Windows required"),
    check("jianying-executable", Boolean(executable && existsSync(executable)), executable ? "configured" : "missing"),
    check("jianying-draft-root", Boolean(draftRoot && existsSync(draftRoot)), draftRoot ? "configured" : "missing"),
    check("ffmpeg", Boolean(ffmpeg && existsSync(ffmpeg)), ffmpeg ? "configured" : "missing"),
  ];
  return { ready: checks.every((item) => item.ready), checks };
}

function validateCase(value, index) {
  if (!record(value)) throw new Error(`case ${index} must be an object`);
  for (const name of ["id", "adapter", "baseUrl", "apiKeyEnv", "capability", "upstreamModel"])
    if (typeof value[name] !== "string" || !value[name].trim()) throw new Error(`case ${index}.${name} is required`);
  if (!adapters.has(value.adapter)) throw new Error(`case ${index}.adapter is unsupported`);
  if (!capabilities.has(value.capability)) throw new Error(`case ${index}.capability is unsupported`);
  if (!validHttpsUrl(value.baseUrl)) throw new Error(`case ${index}.baseUrl must use HTTPS`);
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value.apiKeyEnv)) throw new Error(`case ${index}.apiKeyEnv is unsafe`);
  if (!record(value.parameters)) throw new Error(`case ${index}.parameters must be an object`);
  return { id: value.id, adapter: value.adapter, apiKeyEnv: value.apiKeyEnv };
}

function findExecutable(names, pathValue) {
  for (const directory of String(pathValue || "").split(delimiter))
    for (const name of names) {
      const candidate = `${directory.replace(/[\\/]+$/, "")}/${name}`;
      if (directory && existsSync(candidate)) return candidate;
    }
  return undefined;
}
function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function check(name, ready, detail) { return { name, ready, detail }; }
function safeError(error) { return (error instanceof Error ? error.message : "invalid configuration").replace(/[A-Z]:\\[^\s]+|\/[\w./-]+/g, "[path]").slice(0, 300); }

export function formatReport(report) {
  const lines = [`Runtime preflight: ${report.ready ? "READY" : "PENDING"}`];
  for (const [requirement, group] of Object.entries(report.requirements)) {
    lines.push(`${group.ready ? "PASS" : "PENDING"} ${requirement}`);
    for (const item of group.checks) lines.push(`  ${item.ready ? "[x]" : "[ ]"} ${item.name}: ${item.detail}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = inspectRuntime();
  process.stdout.write(`${process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
  if (!report.ready && !process.argv.includes("--allow-pending")) process.exitCode = 2;
}
