import { describe, expect, it } from "vitest";
import { extractAssetIds } from "./asset-references.js";

describe("extractAssetIds", () => {
  it("finds nested references without following cycles", () => {
    const document: Record<string, unknown> = {
      assetId: "root",
      nodes: [{ metadata: { assetId: "nested" } }, { assetId: 42 }],
    };
    document.self = document;
    expect([...extractAssetIds(document)].sort()).toEqual(["nested", "root"]);
  });
});
