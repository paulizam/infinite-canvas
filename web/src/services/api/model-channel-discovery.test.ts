import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("axios", () => ({ default: { get: mocks.get, isAxiosError: () => false } }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { fetchChannelModels } from "@/services/api/image";

describe("channel model discovery [GEN-005]", () => {
    beforeEach(() => mocks.get.mockReset());

    it("fetches and sorts OpenAI-compatible models with channel credentials", async () => {
        mocks.get.mockResolvedValue({ data: { data: [{ id: "z-model" }, { id: "a-model" }, {}] } });
        await expect(fetchChannelModels({ id: "one", name: "One", baseUrl: "https://provider.example", apiKey: "secret", apiFormat: "openai", models: [] })).resolves.toEqual(["a-model", "z-model"]);
        expect(mocks.get).toHaveBeenCalledWith("https://provider.example/v1/models", { headers: { Authorization: "Bearer secret" } });
    });

    it("normalizes Gemini model resource names without putting the key in the URL", async () => {
        mocks.get.mockResolvedValue({ data: { models: [{ name: "models/gemini-z" }, { name: "models/gemini-a" }] } });
        await expect(fetchChannelModels({ id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", apiKey: "gemini-secret", apiFormat: "gemini", models: [] })).resolves.toEqual(["gemini-a", "gemini-z"]);
        const [url, options] = mocks.get.mock.calls[0];
        expect(url).not.toContain("gemini-secret");
        expect(options.headers).toMatchObject({ "x-goog-api-key": "gemini-secret" });
    });
});
