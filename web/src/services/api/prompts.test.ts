import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = new Map<string, unknown>();
const customSource = {
    id: "custom-json",
    name: "Custom JSON",
    url: "https://prompts.example/catalog/prompts.json",
    homepage: "https://prompts.example",
    enabled: true,
    builtIn: false,
};
const sourceState = { sources: [customSource] };

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            getItem: async (key: string) => cache.get(key) ?? null,
            setItem: async (key: string, value: unknown) => {
                cache.set(key, value);
                return value;
            },
        }),
    },
}));
vi.mock("@/i18n", () => ({
    default: { t: (key: string) => key },
}));
vi.mock("@/stores/use-prompt-source-store", () => ({
    usePromptSourceStore: { getState: () => sourceState },
}));

import { DEFAULT_PROMPT_SOURCES } from "./prompt-source-presets";
import { fetchPrompts, refreshSource } from "./prompts";

describe("[AST-008] prompt sources", () => {
    beforeEach(() => {
        cache.clear();
        vi.restoreAllMocks();
    });

    it("ships seven immutable built-in registry sources", () => {
        expect(DEFAULT_PROMPT_SOURCES).toHaveLength(7);
        expect(new Set(DEFAULT_PROMPT_SOURCES.map((source) => source.id)).size).toBe(7);
        expect(DEFAULT_PROMPT_SOURCES).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ builtIn: true, enabled: true, url: expect.stringMatching(/^https:\/\//) }),
            ]),
        );
    });

    it("loads custom JSON, searches tags, caches results and refreshes explicitly", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
            new Response(
                JSON.stringify([
                    { id: "p1", title: "Neon City", prompt: "rainy cyberpunk street", tags: ["city", "night"] },
                    { id: "p2", title: "Forest", prompt: "quiet woodland", tags: ["nature"] },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        );

        const first = await fetchPrompts({ keyword: "cyberpunk", tag: ["night"] });
        expect(first.items.map((item) => item.id)).toEqual(["p1"]);
        expect(first.tags).toEqual(expect.arrayContaining(["city", "night"]));
        expect(first.categories).toEqual(["Custom JSON"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await fetchPrompts({ category: "Custom JSON" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await refreshSource(customSource.id);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
