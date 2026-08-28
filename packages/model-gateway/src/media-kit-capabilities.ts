export const MEDIA_KIT_VIDEO_ENHANCE_MODES = [
  "fast",
  "standard",
  "pro",
  "llm",
] as const;
export const MEDIA_KIT_SUBTITLE_ERASE_MODES = ["standard", "refined"] as const;

export type MediaKitVideoEnhanceMode =
  (typeof MEDIA_KIT_VIDEO_ENHANCE_MODES)[number];
export type MediaKitSubtitleEraseMode =
  (typeof MEDIA_KIT_SUBTITLE_ERASE_MODES)[number];
export type MediaKitConfig = {
  enabled: boolean;
  videoEnhance: Record<MediaKitVideoEnhanceMode, boolean>;
  subtitleErase: Record<MediaKitSubtitleEraseMode, boolean>;
};

export function defaultMediaKitConfig(): MediaKitConfig {
  return {
    enabled: false,
    videoEnhance: { fast: false, standard: false, pro: false, llm: false },
    subtitleErase: { standard: false, refined: false },
  };
}

export function normalizeMediaKitConfig(value: unknown): MediaKitConfig {
  const source = object(value);
  const videoEnhance = object(source?.videoEnhance);
  const subtitleErase = object(source?.subtitleErase);
  return {
    enabled: source?.enabled === true,
    videoEnhance: {
      fast: videoEnhance?.fast === true,
      standard: videoEnhance?.standard === true,
      pro: videoEnhance?.pro === true,
      llm: videoEnhance?.llm === true,
    },
    subtitleErase: {
      standard: subtitleErase?.standard === true,
      refined: subtitleErase?.refined === true,
    },
  };
}

export function validateMediaKitConfig(config: MediaKitConfig) {
  return (
    !config.enabled ||
    MEDIA_KIT_VIDEO_ENHANCE_MODES.some((mode) => config.videoEnhance[mode]) ||
    MEDIA_KIT_SUBTITLE_ERASE_MODES.some((mode) => config.subtitleErase[mode])
  );
}

export function listEnabledMediaKitCapabilities(config: MediaKitConfig) {
  return {
    videoEnhance: MEDIA_KIT_VIDEO_ENHANCE_MODES.filter(
      (mode) => config.videoEnhance[mode],
    ),
    subtitleErase: MEDIA_KIT_SUBTITLE_ERASE_MODES.filter(
      (mode) => config.subtitleErase[mode],
    ),
  };
}

export function assertMediaKitRequestAllowed(
  value: unknown,
  parameters: Record<string, unknown>,
) {
  // Channels created before the capability matrix existed remain compatible.
  if (value === undefined) return;
  const config = normalizeMediaKitConfig(value);
  if (!validateMediaKitConfig(config))
    throw new Error("Media Kit config must enable at least one capability");
  if (!config.enabled) throw new Error("Media Kit is disabled for this channel");
  const operation = parameters.operation;
  const mode = parameters.mode;
  if (operation === "video-enhance") {
    if (
      typeof mode !== "string" ||
      !MEDIA_KIT_VIDEO_ENHANCE_MODES.includes(
        mode as MediaKitVideoEnhanceMode,
      ) ||
      !config.videoEnhance[mode as MediaKitVideoEnhanceMode]
    )
      throw new Error(`Media Kit video-enhance mode is not enabled: ${String(mode)}`);
    return;
  }
  if (operation === "subtitle-erase") {
    if (
      typeof mode !== "string" ||
      !MEDIA_KIT_SUBTITLE_ERASE_MODES.includes(
        mode as MediaKitSubtitleEraseMode,
      ) ||
      !config.subtitleErase[mode as MediaKitSubtitleEraseMode]
    )
      throw new Error(`Media Kit subtitle-erase mode is not enabled: ${String(mode)}`);
    return;
  }
  throw new Error(`Unsupported Media Kit operation: ${String(operation)}`);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
