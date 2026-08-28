import { describe, expect, it } from "vitest";
import {
  buildVolcengineOperation,
  buildVolcengineRequest,
  normalizeVolcenginePayload,
  signedVolcengineQuery,
} from "./volcengine.js";

const base = {
  baseUrl: "https://open.volcengineapi.com",
  secretAccessKey: "secret-key",
  config: { accessKeyId: "AKLTEXAMPLE", region: "cn-north-1", service: "ark" },
  now: new Date("2026-08-28T01:02:03.000Z"),
};

describe("Volcengine AK/SK adapter", () => {
  it("[GEN-017] signs generation without putting credentials in URL or body", () => {
    const request = buildVolcengineRequest({
      ...base,
      capability: "video",
      upstreamModel: "seedance-1",
      parameters: { prompt: "scene", model: "forged" },
    });
    expect(request.url).toContain("Action=SubmitTask");
    expect(request.url).not.toContain("AKLTEXAMPLE");
    expect(request.init.headers).toMatchObject({
      "x-date": "20260828T010203Z",
    });
    expect(
      (request.init.headers as Record<string, string>).authorization,
    ).toMatch(/^HMAC-SHA256 Credential=AKLTEXAMPLE\//);
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      Model: "seedance-1",
      prompt: "scene",
    });
  });
  it("[GEN-017] signs inventory, usage and task operations deterministically", () => {
    expect(
      signedVolcengineQuery({ ...base, action: "ListResourcePackages" }).url,
    ).toContain("Action=ListResourcePackages");
    expect(
      JSON.parse(
        String(
          buildVolcengineOperation({
            ...base,
            operation: "cancel",
            taskId: "task-1",
          }).init.body,
        ),
      ),
    ).toEqual({ TaskId: "task-1" });
  });
  it("normalizes Volcengine task and output casing", () =>
    expect(
      normalizeVolcenginePayload({
        Result: {
          TaskId: "t-1",
          Status: "Running",
          OutputUrl: "https://cdn.example/out.mp4",
        },
      }),
    ).toMatchObject({
      id: "t-1",
      status: "running",
      data: [{ url: "https://cdn.example/out.mp4" }],
    }));
  it("requires AK/SK and safe HTTPS endpoints", () => {
    expect(() =>
      signedVolcengineQuery({ ...base, config: {}, action: "GetUsage" }),
    ).toThrow(/AK\/SK/);
    expect(() =>
      signedVolcengineQuery({
        ...base,
        baseUrl: "http://example.com",
        action: "GetUsage",
      }),
    ).toThrow(/HTTPS/);
  });
});
