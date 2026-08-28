export type VolcengineResourcePackage = {
  InstanceNo?: string;
  ConfigurationCode?: string;
  ConfigurationName?: string;
  TotalAmount?: string;
  AvailableAmount?: string;
  Unit?: string;
  Status?: string;
  EffectiveTime?: string;
  ExpiryTime?: string;
};

export type VolcenginePackageUsage = {
  configurationCode: string;
  configurationName?: string;
  unit: string;
  quota: number;
  used: number;
  remaining: number;
  expired: number;
  usagePercent: number;
  overQuota: boolean;
  packages: { effective: number; usedUp: number; expired: number };
};

const priority: Record<string, number> = {
  Expired: 50,
  UsedUp: 40,
  Effective: 30,
  NotEffective: 20,
  Refunded: 10,
  FailedToCreate: 0,
};
const countable = new Set(["Effective", "UsedUp", "Expired"]);

export function parseVolcengineResourcePackages(
  payload: unknown,
): VolcengineResourcePackage[] {
  const root = object(payload);
  const result = object(root?.Result) || object(root?.result) || root;
  const candidates = [
    result?.List,
    result?.ResourcePackages,
    result?.resourcePackages,
    result?.items,
    object(result?.Data)?.List,
    object(result?.data)?.list,
  ];
  const rows = candidates.find(Array.isArray);
  return Array.isArray(rows)
    ? rows.filter((item): item is VolcengineResourcePackage =>
        Boolean(object(item)),
      )
    : [];
}

export function mergeVolcengineResourcePackages(
  rows: readonly VolcengineResourcePackage[],
) {
  const merged = new Map<string, VolcengineResourcePackage>();
  for (const row of rows) {
    const key =
      row.InstanceNo?.trim() ||
      [
        row.ConfigurationCode,
        row.Status,
        row.TotalAmount,
        row.AvailableAmount,
        row.EffectiveTime,
      ].join(":");
    const old = merged.get(key);
    if (
      !old ||
      (priority[row.Status || ""] ?? -1) > (priority[old.Status || ""] ?? -1)
    )
      merged.set(key, row);
  }
  return [...merged.values()];
}

export function summarizeVolcengineResourcePackages(
  rows: readonly VolcengineResourcePackage[],
): VolcenginePackageUsage[] {
  const groups = new Map<string, VolcengineResourcePackage[]>();
  for (const row of mergeVolcengineResourcePackages(rows)) {
    if (!countable.has(row.Status || "") || !row.ConfigurationCode?.trim())
      continue;
    const list = groups.get(row.ConfigurationCode) || [];
    list.push(row);
    groups.set(row.ConfigurationCode, list);
  }
  return [...groups.entries()].map(([configurationCode, items]) => {
    const units = new Set(items.map((row) => row.Unit || "unknown"));
    if (units.size !== 1)
      throw new Error(`Mixed resource package units: ${configurationCode}`);
    const sum = (status: string, field: "TotalAmount" | "AvailableAmount") =>
      items
        .filter((row) => row.Status === status)
        .reduce((total, row) => total + amount(row[field]), 0);
    const quota =
      sum("Effective", "TotalAmount") +
      sum("UsedUp", "TotalAmount") +
      sum("Expired", "TotalAmount");
    const remaining = sum("Effective", "AvailableAmount");
    const expired = sum("Expired", "AvailableAmount");
    const used = Math.max(0, quota - remaining - expired);
    return {
      configurationCode,
      configurationName: items.find((row) => row.ConfigurationName)
        ?.ConfigurationName,
      unit: [...units][0]!,
      quota,
      used,
      remaining,
      expired,
      usagePercent: quota ? Math.round((used / quota) * 100) : 0,
      overQuota: quota > 0 && remaining <= 0,
      packages: {
        effective: items.filter((row) => row.Status === "Effective").length,
        usedUp: items.filter((row) => row.Status === "UsedUp").length,
        expired: items.filter((row) => row.Status === "Expired").length,
      },
    };
  });
}

const amount = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
