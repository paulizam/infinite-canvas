export function extractAssetIds(
  value: unknown,
  found = new Set<string>(),
  seen = new WeakSet<object>(),
): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) extractAssetIds(item, found, seen);
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "assetId" && typeof child === "string" && child.trim())
      found.add(child);
    else extractAssetIds(child, found, seen);
  }
  return found;
}
