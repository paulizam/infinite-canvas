import { describe, expect, it } from "vitest";
import { canvasStorageName } from "@/lib/canvas/canvas-storage-scope";

describe("canvas storage namespace", () => {
    it("keeps Local mode on the legacy key", () => expect(canvasStorageName("canvas", false, null)).toBe("canvas"));
    it("isolates every Server workspace", () => {
        expect(canvasStorageName("canvas", true, "workspace-a")).toBe("canvas:cloud:workspace-a");
        expect(canvasStorageName("canvas", true, "workspace-b")).toBe("canvas:cloud:workspace-b");
    });
});
