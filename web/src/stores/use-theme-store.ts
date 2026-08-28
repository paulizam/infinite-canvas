import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

export function normalizeThemeName(value: unknown): ThemeName {
    return value === "light" || value === "dark" ? value : "dark";
}

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: "infinite-canvas:theme_store",
            merge: (persisted, current) => {
                const state = persisted && typeof persisted === "object" ? (persisted as Partial<ThemeStore>) : {};
                return { ...current, theme: normalizeThemeName(state.theme) };
            },
        },
    ),
);
