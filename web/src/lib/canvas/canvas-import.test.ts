import { describe, expect, it } from "vitest";
import { parseCanvasExportFile } from "./canvas-import";

describe("parseCanvasExportFile", () => {
    it.each([3, 4])("accepts export version %s", (version) => expect(parseCanvasExportFile({ app: "infinite-canvas", version, exportedAt: "x", projects: [] }).version).toBe(version));
    it("rejects unknown versions", () => expect(() => parseCanvasExportFile({ app: "infinite-canvas", version: 5, projects: [] })).toThrow(/Unsupported/));
});
