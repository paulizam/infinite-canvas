import { describe, expect, it } from "vitest";

import { assertCanvasWritable, isCanvasReadOnly, isReadOnlyWriteKey } from "./canvas-write-access";

describe("canvas write access", () => {
    it("makes only Server-mode viewers read-only", () => {
        expect(isCanvasReadOnly(true, "viewer")).toBe(true);
        expect(isCanvasReadOnly(true, "editor")).toBe(false);
        expect(isCanvasReadOnly(false, "viewer")).toBe(false);
        expect(isCanvasReadOnly(true, undefined)).toBe(false);
    });

    it("fails closed with a stable capability error", () => {
        expect(() => assertCanvasWritable(true)).toThrow(expect.objectContaining({ name: "CanvasReadOnlyError", message: "CANVAS_READ_ONLY" }));
        expect(() => assertCanvasWritable(false)).not.toThrow();
    });

    it("blocks write shortcuts while leaving selection and copy available", () => {
        expect(isReadOnlyWriteKey({ key: "Delete" })).toBe(true);
        expect(isReadOnlyWriteKey({ key: "v", ctrlKey: true })).toBe(true);
        expect(isReadOnlyWriteKey({ key: "c", ctrlKey: true })).toBe(false);
        expect(isReadOnlyWriteKey({ key: "a", metaKey: true })).toBe(false);
    });
});
