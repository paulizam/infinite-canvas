const ASSET_SUBTYPES = new Set(["image", "video", "audio"]);

export function isWorkflowValueTypeCompatible(source: string, target: string) {
  const sources = parseUnion(source);
  const targets = parseUnion(target);
  if (!sources.length || !targets.length) return false;
  return sources.every((from) => targets.some((to) => assignable(from, to)));
}

function assignable(source: string, target: string): boolean {
  if (target === "any" || source === target) return true;
  if (source === "any") return false;
  const sourceArray = unwrapArray(source);
  const targetArray = unwrapArray(target);
  if (sourceArray || targetArray)
    return Boolean(
      sourceArray && targetArray && assignable(sourceArray, targetArray),
    );
  return target === "asset" && ASSET_SUBTYPES.has(source);
}

function unwrapArray(value: string) {
  return value.endsWith("[]") ? value.slice(0, -2) : "";
}

function parseUnion(value: string) {
  return [
    ...new Set(
      value
        .split("|")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
