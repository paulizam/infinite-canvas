import { describe, expect, it } from "vitest";
import {
  parseVolcengineResourcePackages,
  summarizeVolcengineResourcePackages,
} from "./volcengine-resource-packages.js";

describe("Volcengine resource package metering [GEN-017]", () => {
  it("deduplicates status passes and separates used, remaining and expired quota", () => {
    const rows = parseVolcengineResourcePackages({
      Result: {
        List: [
          {
            InstanceNo: "a",
            ConfigurationCode: "Seedance_pack",
            ConfigurationName: "Seedance",
            Status: "Effective",
            TotalAmount: "100",
            AvailableAmount: "40",
            Unit: "次",
          },
          {
            InstanceNo: "b",
            ConfigurationCode: "Seedance_pack",
            Status: "UsedUp",
            TotalAmount: "50",
            AvailableAmount: "0",
            Unit: "次",
          },
          {
            InstanceNo: "c",
            ConfigurationCode: "Seedance_pack",
            Status: "Expired",
            TotalAmount: "20",
            AvailableAmount: "5",
            Unit: "次",
          },
          {
            InstanceNo: "a",
            ConfigurationCode: "Seedance_pack",
            Status: "NotEffective",
            TotalAmount: "100",
            AvailableAmount: "100",
            Unit: "次",
          },
        ],
      },
    });
    expect(summarizeVolcengineResourcePackages(rows)).toEqual([
      expect.objectContaining({
        configurationCode: "Seedance_pack",
        quota: 170,
        used: 125,
        remaining: 40,
        expired: 5,
        usagePercent: 74,
        packages: { effective: 1, usedUp: 1, expired: 1 },
      }),
    ]);
  });

  it("rejects mixed units instead of presenting a false aggregate", () => {
    expect(() =>
      summarizeVolcengineResourcePackages([
        {
          InstanceNo: "a",
          ConfigurationCode: "mixed",
          Status: "Effective",
          TotalAmount: "1",
          AvailableAmount: "1",
          Unit: "张",
        },
        {
          InstanceNo: "b",
          ConfigurationCode: "mixed",
          Status: "UsedUp",
          TotalAmount: "1",
          AvailableAmount: "0",
          Unit: "tokens",
        },
      ]),
    ).toThrow(/Mixed resource package units/);
  });
});
