import { describe, expect, it } from "vitest";
import {
  buildProviderSpecificRequest,
  normalizeProviderSpecificPayload,
  providerSpecificOperation,
} from "./provider-specific.js";

const base = {
  baseUrl: "https://provider.example",
  apiKey: "secret",
  upstreamModel: "model-1",
  config: {},
  allowInsecure: false,
};

describe("provider-specific adapters", () => {
  it("builds Seedance multimodal tasks and encodes task operations", () => {
    const request = buildProviderSpecificRequest("seedance", {
      ...base,
      capability: "video",
      parameters: {
        prompt: "scene",
        images: ["data:image/png;base64,AA=="],
        duration: 5,
      },
    });
    expect(request.url).toBe(
      "https://provider.example/api/v3/contents/generations/tasks",
    );
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      model: "model-1",
      content: [{ type: "text", text: "scene" }, { type: "image_url" }],
      duration: 5,
    });
    expect(
      providerSpecificOperation("seedance", {
        ...base,
        operation: "poll",
        taskId: "a/b",
      }).url,
    ).toContain("a%2Fb");
  });
  it("maps A1111 and Forge img2img without allowing model override", () => {
    const request = buildProviderSpecificRequest("stable-diffusion", {
      ...base,
      capability: "image",
      parameters: {
        prompt: "draw",
        model: "forged",
        references: ["data:image/png;base64,AA=="],
        steps: 20,
      },
    });
    expect(request.url).toBe("https://provider.example/sdapi/v1/img2img");
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      prompt: "draw",
      init_images: ["data:image/png;base64,AA=="],
      steps: 20,
      override_settings: { sd_model_checkpoint: "model-1" },
    });
  });
  it("normalizes Stable Diffusion images and MediaKit result URLs", () => {
    expect(
      normalizeProviderSpecificPayload("stable-diffusion", { images: ["abc"] }),
    ).toMatchObject({ status: "succeeded", data: [{ base64: "abc" }] });
    expect(
      normalizeProviderSpecificPayload("media-kit", {
        status: "completed",
        output: { url: "https://cdn.example/out.png" },
      }),
    ).toMatchObject({
      status: "completed",
      data: [{ url: "https://cdn.example/out.png" }],
    });
  });
  it("rejects capability and unsafe path mismatches", () => {
    expect(() =>
      buildProviderSpecificRequest("stable-diffusion", {
        ...base,
        capability: "video",
        parameters: {},
      }),
    ).toThrow(/only supports image/);
    expect(() =>
      buildProviderSpecificRequest("media-kit", {
        ...base,
        capability: "text",
        parameters: {},
        config: { submitPath: "/../admin" },
      }),
    ).toThrow();
  });
});
