import { describe, expect, it } from "vitest";
import {
  assertMediaKitRequestAllowed,
  defaultMediaKitConfig,
  listEnabledMediaKitCapabilities,
  normalizeMediaKitConfig,
  validateMediaKitConfig,
} from "./media-kit-capabilities.js";

describe("MediaKit capability matrix", () => {
  it("[GEN-018] normalizes untrusted config and lists enabled capabilities", () => {
    const config = normalizeMediaKitConfig({
      enabled: true,
      videoEnhance: { fast: true, standard: "yes" },
      subtitleErase: { refined: true },
    });
    expect(validateMediaKitConfig(config)).toBe(true);
    expect(listEnabledMediaKitCapabilities(config)).toEqual({
      videoEnhance: ["fast"],
      subtitleErase: ["refined"],
    });
  });

  it("[GEN-018] rejects enabled empty matrices and disabled channels", () => {
    expect(validateMediaKitConfig({ ...defaultMediaKitConfig(), enabled: true })).toBe(false);
    expect(() =>
      assertMediaKitRequestAllowed(defaultMediaKitConfig(), {
        operation: "video-enhance",
        mode: "fast",
      }),
    ).toThrow(/disabled/);
  });

  it("[GEN-018] gates operation and mode while preserving legacy channels", () => {
    const config = {
      enabled: true,
      videoEnhance: { fast: true },
      subtitleErase: { refined: true },
    };
    expect(() =>
      assertMediaKitRequestAllowed(config, {
        operation: "video-enhance",
        mode: "fast",
      }),
    ).not.toThrow();
    expect(() =>
      assertMediaKitRequestAllowed(config, {
        operation: "video-enhance",
        mode: "pro",
      }),
    ).toThrow(/not enabled/);
    expect(() =>
      assertMediaKitRequestAllowed(config, { operation: "unknown", mode: "fast" }),
    ).toThrow(/Unsupported/);
    expect(() => assertMediaKitRequestAllowed(undefined, {})).not.toThrow();
  });
});
