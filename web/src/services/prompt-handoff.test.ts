import { describe, expect, it, vi } from "vitest";
import { handoffPrompt } from "./prompt-handoff";
import type { Prompt } from "./api/prompts";

const prompt = { id: "p1", title: "Story", prompt: "A city at dawn", tags: ["city"], targets: ["agent", "canvas", "drama"] } as Prompt;
describe("[AST-009] prompt handoff", () => {
    it("routes Canvas through a durable text asset", () => {
        const addTextAsset = vi.fn(() => "asset-1"), prepareAgent = vi.fn();
        expect(handoffPrompt(prompt, "canvas", { addTextAsset, prepareAgent })).toBe("/canvas");
        expect(addTextAsset).toHaveBeenCalledWith(expect.objectContaining({ content: prompt.prompt, metadata: expect.objectContaining({ handoffTarget: "canvas" }) }));
        expect(prepareAgent).not.toHaveBeenCalled();
    });
    it("prefills Agent and Drama while enforcing catalog targets", () => {
        const addTextAsset = vi.fn(() => "asset-1"), prepareAgent = vi.fn();
        handoffPrompt(prompt, "agent", { addTextAsset, prepareAgent });
        expect(prepareAgent).toHaveBeenLastCalledWith(prompt.prompt);
        handoffPrompt(prompt, "drama", { addTextAsset, prepareAgent });
        expect(prepareAgent).toHaveBeenLastCalledWith(expect.stringContaining("创建短剧"));
        expect(() => handoffPrompt({ ...prompt, targets: ["canvas"] }, "agent", { addTextAsset, prepareAgent })).toThrow("PROMPT_TARGET_NOT_ALLOWED");
    });
});
