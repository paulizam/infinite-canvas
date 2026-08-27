import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { AGENT_PROMPT } from "../config.js";
import { createAgentLogWriter } from "../utils/agent-runtime.js";
import { errorMessage } from "../utils/value.js";
import type { AgentEmit } from "./types.js";

type ClaudeQuery = typeof query;

/** 使用官方 Claude Agent SDK 执行一次带 Canvas MCP 工具的任务。 */
export function runClaudeTurn(prompt: string, emit: AgentEmit) {
    void runClaudeSdkTurn(prompt, emit);
}

export async function runClaudeSdkTurn(prompt: string, emit: AgentEmit, sdkQuery: ClaudeQuery = query) {
    const userPrompt = prompt.trim();
    if (!userPrompt) return 0;
    const stderr = createAgentLogWriter((text) => emit("agent_log", { text }));
    let exitCode = 0;
    try {
        const messages = sdkQuery({
            prompt: userPrompt,
            options: {
                allowedTools: ["mcp__infinite-canvas__*"],
                includePartialMessages: true,
                settingSources: ["user", "project", "local"],
                systemPrompt: { type: "preset", preset: "claude_code", append: AGENT_PROMPT },
                stderr: (text) => stderr.write(text),
            },
        });
        for await (const sdkMessage of messages) {
            const message = sdkMessage as SDKMessage;
            emit("agent_event", { agent: "claude", ...message });
            if (message.type === "result" && message.subtype !== "success") {
                exitCode = 1;
                emit("agent_error", { message: message.errors.join("\n") || message.subtype });
            }
        }
    } catch (error) {
        exitCode = 1;
        emit("agent_error", { message: errorMessage(error) });
    } finally {
        stderr.flush();
        emit("agent_done", { agent: "claude", code: exitCode });
    }
    return exitCode;
}
