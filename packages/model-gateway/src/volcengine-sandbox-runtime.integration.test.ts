import { describe, expect, it } from "vitest";

import { signedVolcengineQuery } from "./volcengine.js";

const baseUrl = process.env.VOLCENGINE_SANDBOX_BASE_URL?.trim();
const accessKeyId = process.env.VOLCENGINE_SANDBOX_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.VOLCENGINE_SANDBOX_SECRET_ACCESS_KEY?.trim();
const enabled = Boolean(baseUrl && accessKeyId && secretAccessKey);

describe.runIf(enabled)("real Volcengine AK/SK sandbox [GEN-017]", () => {
  it.each([
    ["models", process.env.VOLCENGINE_MODELS_ACTION || "ListFoundationModels"],
    ["resources", process.env.VOLCENGINE_RESOURCES_ACTION || "ListResourcePackages"],
    ["usage", process.env.VOLCENGINE_USAGE_ACTION || "GetResourceUsage"],
  ])("queries %s inventory with a signed request", async (_kind, action) => {
    const request = signedVolcengineQuery({
      baseUrl: baseUrl!,
      secretAccessKey: secretAccessKey!,
      config: {
        accessKeyId,
        region: process.env.VOLCENGINE_REGION || "cn-north-1",
        service: process.env.VOLCENGINE_SERVICE || "ark",
      },
      action,
      version: process.env.VOLCENGINE_API_VERSION || "2022-01-01",
    });
    const response = await fetch(request.url, { ...request.init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2 * 1024 * 1024);
    const payload = JSON.parse(text) as Record<string, unknown>;
    const metadata = payload.ResponseMetadata as { Error?: unknown } | undefined;
    expect(metadata?.Error).toBeUndefined();
    expect(Object.keys(payload).length).toBeGreaterThan(0);
  });
});
