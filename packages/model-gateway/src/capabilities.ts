import type { ModelCapabilityProfile } from "@infinite-canvas/contracts";

export type CapabilityIssue = { code: string; field: string; message: string };

export function validateModelParameters(
  profile: ModelCapabilityProfile,
  parameters: Record<string, unknown>,
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  validateReferences(issues, profile, parameters);
  allowedValue(
    issues,
    "aspectRatio",
    parameters.aspectRatio,
    profile.aspectRatios,
  );
  allowedValue(
    issues,
    "resolution",
    parameters.resolution,
    profile.resolutions,
  );
  const duration = number(parameters.durationSeconds);
  if (duration !== undefined) {
    if (
      profile.durationSeconds?.length &&
      !profile.durationSeconds.includes(duration)
    )
      issues.push(
        issue("UNSUPPORTED_DURATION", "durationSeconds", "模型不支持该时长"),
      );
    if (
      profile.minDurationSeconds !== undefined &&
      duration < profile.minDurationSeconds
    )
      issues.push(
        issue("DURATION_TOO_SHORT", "durationSeconds", "时长低于模型下限"),
      );
    if (
      profile.maxDurationSeconds !== undefined &&
      duration > profile.maxDurationSeconds
    )
      issues.push(
        issue("DURATION_TOO_LONG", "durationSeconds", "时长超过模型上限"),
      );
  }
  const count = number(parameters.count);
  if (
    count !== undefined &&
    profile.maxBatchSize !== undefined &&
    count > profile.maxBatchSize
  )
    issues.push(issue("BATCH_TOO_LARGE", "count", "生成数量超过模型上限"));
  return issues;
}

function validateReferences(
  issues: CapabilityIssue[],
  profile: ModelCapabilityProfile,
  parameters: Record<string, unknown>,
) {
  const checks = [
    [
      "referenceImages",
      profile.supportsReferenceImage,
      profile.maxReferenceImages,
    ],
    ["referenceVideos", profile.supportsReferenceVideo, undefined],
    ["referenceAudios", profile.supportsReferenceAudio, undefined],
  ] as const;
  for (const [field, supported, maximum] of checks) {
    const values = parameters[field];
    if (!Array.isArray(values) || !values.length) continue;
    if (!supported)
      issues.push(
        issue("REFERENCES_UNSUPPORTED", field, "模型不支持该参考素材"),
      );
    else if (maximum !== undefined && values.length > maximum)
      issues.push(
        issue("TOO_MANY_REFERENCES", field, "参考素材数量超过模型上限"),
      );
  }
}
function allowedValue(
  issues: CapabilityIssue[],
  field: string,
  value: unknown,
  allowed?: string[],
) {
  if (typeof value === "string" && allowed?.length && !allowed.includes(value))
    issues.push(issue("VALUE_UNSUPPORTED", field, "模型不支持该参数值"));
}
function issue(code: string, field: string, message: string) {
  return { code, field, message };
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
