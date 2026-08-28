import { describe, expect, it } from "vitest";
import { parseCanvasExportFile } from "./canvas-import";

describe("parseCanvasExportFile", () => {
    it.each([3, 4])("[BAS-002][CAN-008] accepts export version %s", (version) => expect(parseCanvasExportFile({ app: "infinite-canvas", version, exportedAt: "x", projects: [] }).version).toBe(version));
    it("rejects unknown versions", () => expect(() => parseCanvasExportFile({ app: "infinite-canvas", version: 5, projects: [] })).toThrow(/Unsupported/));
    it("rejects traversal, duplicate keys and oversized asset declarations", () => {
        const project = { id: "project-1", title: "Local", nodes: [], connections: [] };
        const manifest = (files: unknown[]) => ({ app: "infinite-canvas", version: 4, exportedAt: "x", projects: [{ project, files }] });
        expect(() => parseCanvasExportFile(manifest([{ storageKey: "image:a", path: "../secret", mimeType: "image/png", bytes: 1 }]))).toThrow(/path/);
        const file = { storageKey: "image:a", path: "projects/project-1/files/a.png", mimeType: "image/png", bytes: 1 };
        expect(() => parseCanvasExportFile(manifest([file, { ...file, path: "projects/project-1/files/b.png" }]))).toThrow(/Duplicate/);
        expect(() => parseCanvasExportFile(manifest([{ ...file, bytes: 64 * 1024 * 1024 + 1 }]))).toThrow(/size/);
    });
});
