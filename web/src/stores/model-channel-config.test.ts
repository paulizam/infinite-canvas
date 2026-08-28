import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { createModelChannel, defaultConfig, encodeChannelModel, modelOptionsFromChannels, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "@/services/api/model-plugin";

describe("multi-channel model configuration [GEN-005]", () => {
    it("keeps duplicate model names independently addressable by channel and preserves custom scripts", () => {
        const primary = createModelChannel({ id: "primary", name: "Primary", baseUrl: "https://one.example", apiKey: "one-secret", models: [{ name: "shared-model", capability: "text" }] });
        const backup = createModelChannel({ id: "backup", name: "Backup", baseUrl: "https://two.example/v1", apiKey: "two-secret", models: [{ name: "shared-model", capability: "text", script: " return prompt; " }] });
        const config = { ...defaultConfig, channels: [primary, backup] } as AiConfig;
        expect(modelOptionsFromChannels(config.channels)).toEqual(["primary::shared-model", "backup::shared-model"]);
        expect(resolveModelRequestConfig(config, encodeChannelModel("backup", "shared-model"))).toMatchObject({ model: "shared-model", baseUrl: "https://two.example/v1", apiKey: "two-secret" });
        expect(resolveModelScript(config, "backup::shared-model")).toBe("return prompt;");
    });

    it("executes a model-scoped custom call script with normalized channel locals", async () => {
        await expect(runModelPlugin({ capability: "text", script: "return { model, baseUrl, prompt, reasoningEffort };", config: { ...defaultConfig, model: "custom-text", baseUrl: "https://provider.example", reasoningEffort: "high" }, prompt: "rewrite" })).resolves.toEqual({ model: "custom-text", baseUrl: "https://provider.example", prompt: "rewrite", reasoningEffort: "high" });
    });
});
