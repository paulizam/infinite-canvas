import { readFileSync } from "node:fs";

import type { ModelCapability } from "@infinite-canvas/contracts";
import { describe, expect, it } from "vitest";

import type { WorkerResolvedModel } from "./client.js";
import {
  buildOperationRequest,
  buildSubmitRequest,
  isPending,
  normalizePayload,
  providerFetch,
  safeJson,
  taskId,
  upstreamStatus,
} from "./provider-runtime.js";

type SandboxCase = {
  id: string;
  adapter: "openai-compatible" | "gemini" | "seedance" | "stable-diffusion" | "media-kit";
  baseUrl: string;
  apiKeyEnv: string;
  capability: ModelCapability;
  upstreamModel: string;
  parameters: Record<string, unknown>;
  protocolConfig?: Record<string, unknown>;
  channelConfig?: Record<string, unknown>;
  pollIntervalMs?: number;
  pollAttempts?: number;
};

const casesFile = process.env.PROVIDER_SANDBOX_CASES_FILE?.trim();
const cases = casesFile ? loadCases(casesFile) : [];

describe.runIf(cases.length > 0)("real upstream provider sandboxes [GEN-008][GEN-018]", () => {
  it.each(cases)("$id submit/poll/result", async (runtimeCase) => {
    const apiKey = process.env[runtimeCase.apiKeyEnv]?.trim();
    if (!apiKey) throw new Error(`Missing credential environment variable: ${runtimeCase.apiKeyEnv}`);
    const resolved = model(runtimeCase, apiKey);
    const submitted = buildSubmitRequest(resolved, runtimeCase.capability, runtimeCase.parameters);
    const response = await providerFetch(fetch, submitted.url, submitted.init);
    expect(response.status, `submit response from ${runtimeCase.id}`).toBeGreaterThanOrEqual(200);
    expect(response.status, `submit response from ${runtimeCase.id}`).toBeLessThan(300);
    let payload = normalizePayload(resolved, await safeJson(response), runtimeCase.capability);
    let status = upstreamStatus(payload, resolved);
    let upstreamTaskId = taskId(payload, resolved);

    for (let attempt = 0; upstreamTaskId && isPending(status) && attempt < (runtimeCase.pollAttempts ?? 60); attempt++) {
      await delay(runtimeCase.pollIntervalMs ?? 5_000);
      const request = buildOperationRequest(resolved, runtimeCase.capability, "poll", upstreamTaskId);
      const polled = await providerFetch(fetch, request.url, request.init);
      expect(polled.status, `poll response from ${runtimeCase.id}`).toBeGreaterThanOrEqual(200);
      expect(polled.status, `poll response from ${runtimeCase.id}`).toBeLessThan(300);
      payload = normalizePayload(resolved, await safeJson(polled), runtimeCase.capability);
      status = upstreamStatus(payload, resolved);
      upstreamTaskId = taskId(payload, resolved) || upstreamTaskId;
    }

    expect(["failed", "error", "cancelled"]).not.toContain(status);
    expect(isPending(status), `provider ${runtimeCase.id} did not finish before the polling deadline`).toBe(false);
    expect(hasUsableResult(payload, runtimeCase.capability), `provider ${runtimeCase.id} returned no usable result`).toBe(true);
  }, 10 * 60_000);
});

function loadCases(path: string): SandboxCase[] {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value) || value.length === 0) throw new Error("Provider sandbox cases must be a non-empty JSON array");
  return value.map((item, index) => validateCase(item, index));
}

function validateCase(value: unknown, index: number): SandboxCase {
  const item = value as Partial<SandboxCase> | null;
  const adapters = ["openai-compatible", "gemini", "seedance", "stable-diffusion", "media-kit"];
  const capabilities = ["text", "image", "video", "audio"];
  if (!item || typeof item.id !== "string" || !adapters.includes(String(item.adapter)) || typeof item.baseUrl !== "string" || typeof item.apiKeyEnv !== "string" || !capabilities.includes(String(item.capability)) || typeof item.upstreamModel !== "string" || !item.parameters || typeof item.parameters !== "object" || Array.isArray(item.parameters)) {
    throw new Error(`Invalid provider sandbox case at index ${index}`);
  }
  return item as SandboxCase;
}

function model(runtimeCase: SandboxCase, apiKey: string): WorkerResolvedModel {
  return {
    protocol: { id: `runtime-${runtimeCase.id}`, adapter: runtimeCase.adapter, enabled: true, config: runtimeCase.protocolConfig || {} },
    channel: { id: `runtime-${runtimeCase.id}`, baseUrl: runtimeCase.baseUrl, config: runtimeCase.channelConfig || {}, enabled: true, credentialConfigured: true },
    upstreamModel: { id: "00000000-0000-4000-8000-000000000001", modelId: runtimeCase.upstreamModel },
    binding: { capabilityProfile: {} },
    apiKey,
  } as WorkerResolvedModel;
}

function hasUsableResult(payload: Record<string, unknown>, capability: ModelCapability) {
  if (capability === "text") return typeof payload.text === "string" && payload.text.length > 0 || Array.isArray(payload.choices) && payload.choices.length > 0;
  const data = payload.data;
  return Array.isArray(data) && data.length > 0;
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
