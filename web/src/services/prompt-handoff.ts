import type { Prompt } from "./api/prompts";

export type PromptHandoffTarget = "agent" | "canvas" | "drama";

export function handoffPrompt(
    prompt: Prompt,
    target: PromptHandoffTarget,
    deps: {
        addTextAsset: (input: { title: string; content: string; tags: string[]; metadata: Record<string, unknown> }) => string;
        prepareAgent: (prompt: string) => void;
    },
) {
    if (prompt.targets?.length && !prompt.targets.includes(target)) throw new Error("PROMPT_TARGET_NOT_ALLOWED");
    if (target === "agent") {
        deps.prepareAgent(prompt.prompt);
        return null;
    }
    deps.addTextAsset({
        title: prompt.title,
        content: prompt.prompt,
        tags: prompt.tags,
        metadata: { source: "prompt-catalog", promptId: prompt.id, handoffTarget: target },
    });
    if (target === "drama") deps.prepareAgent(`请基于以下运营提示词创建短剧项目：\n\n${prompt.prompt}`);
    return target === "canvas" ? "/canvas" : null;
}
