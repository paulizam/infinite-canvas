import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
};

describe("[BAS-001] theme persistence", () => {
    beforeEach(() => {
        values.clear();
        vi.resetModules();
        vi.stubGlobal("localStorage", storage);
        vi.stubGlobal("window", { localStorage: storage });
    });

    it("persists a valid theme and restores it after a module reload", async () => {
        const first = await import("./use-theme-store");
        expect(first.useThemeStore.getState().theme).toBe("dark");
        first.useThemeStore.getState().setTheme("light");
        expect(JSON.parse(values.get("infinite-canvas:theme_store") || "{}").state.theme).toBe("light");

        vi.resetModules();
        const restored = await import("./use-theme-store");
        expect(restored.useThemeStore.getState().theme).toBe("light");
    });

    it("fails safely when persisted theme state is malformed", async () => {
        values.set("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "system", setTheme: "poisoned" }, version: 0 }));
        const restored = await import("./use-theme-store");
        expect(restored.useThemeStore.getState().theme).toBe("dark");
        expect(restored.useThemeStore.getState().setTheme).toBeTypeOf("function");
    });
});
