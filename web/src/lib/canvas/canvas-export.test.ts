import { describe, expect, it, vi } from "vitest";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: () => "Canvas" } }));
vi.mock("@/services/image-storage", () => ({ getImageBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })) }));
vi.mock("@/services/file-storage", () => ({ getMediaBlob: vi.fn(async () => null) }));

import { createCanvasProjectsArchive } from "./canvas-export";
import { parseCanvasExportFile, validateCanvasImportAssets } from "./canvas-import";
import { readZip } from "@/lib/zip";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

describe("[BAS-002][CAN-008] Local canvas archive", () => {
    it("round-trips project metadata and embedded assets", async () => {
        const project = {
            id: "project-1",
            schemaVersion: 4,
            revision: 0,
            title: "Offline",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            nodes: [{ id: "node-1", type: "image", title: "Reference", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, metadata: { storageKey: "image:asset_1" } }],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines",
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
        } as unknown as CanvasProject;
        const entries = await readZip(await createCanvasProjectsArchive([project]));
        const manifestBlob = entries.get("projects.json");
        expect(manifestBlob).toBeDefined();
        const manifest = parseCanvasExportFile(JSON.parse(await manifestBlob!.text()));
        expect(manifest.projects[0]?.project.title).toBe("Offline");
        const assets = validateCanvasImportAssets(manifest, entries);
        expect(assets).toHaveLength(1);
        expect(await assets[0]!.blob.text()).toBe("png");
    });

    it("fails closed when an embedded asset is missing or changed", () => {
        const manifest = parseCanvasExportFile({
            app: "infinite-canvas",
            version: 4,
            exportedAt: "x",
            projects: [{ project: { id: "p", title: "x", nodes: [], connections: [] }, files: [{ storageKey: "image:a", path: "projects/p/files/a.png", mimeType: "image/png", bytes: 3 }] }],
        });
        expect(() => validateCanvasImportAssets(manifest, new Map())).toThrow(/missing/);
        expect(() => validateCanvasImportAssets(manifest, new Map([["projects/p/files/a.png", new Blob(["no"])]]))).toThrow(/size mismatch/);
    });
});
