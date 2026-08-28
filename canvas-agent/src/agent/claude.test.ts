import assert from "node:assert/strict";
import test from "node:test";

import { runClaudeSdkTurn } from "./claude.js";

test("Claude SDK adapter preserves typed streaming events and Canvas MCP policy [AGT-003]", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    let received: Record<string, unknown> | undefined;
    const fakeQuery = ((input: Record<string, unknown>) => {
        received = input;
        return (async function* () {
            yield { type: "system", subtype: "init", session_id: "session-1", uuid: "event-1" };
            yield { type: "result", subtype: "success", session_id: "session-1", uuid: "event-2" };
        })();
    }) as never;

    const code = await runClaudeSdkTurn("  edit canvas  ", (type, payload) => events.push({ type, payload }), fakeQuery);

    assert.equal(code, 0);
    assert.equal(received?.prompt, "edit canvas");
    assert.deepEqual((received?.options as { allowedTools: string[] }).allowedTools, ["mcp__infinite-canvas__*"]);
    assert.deepEqual((received?.options as { settingSources: string[] }).settingSources, ["user", "project", "local"]);
    assert.equal(events.filter((event) => event.type === "agent_event").length, 2);
    assert.deepEqual(events.at(-1), { type: "agent_done", payload: { agent: "claude", code: 0 } });
});

test("Claude SDK adapter turns query failures into terminal events", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const code = await runClaudeSdkTurn(
        "fail",
        (type, payload) => events.push({ type, payload }),
        (() => {
            throw new Error("sdk unavailable");
        }) as never,
    );

    assert.equal(code, 1);
    assert.match(String((events.find((event) => event.type === "agent_error")?.payload as { message: string }).message), /sdk unavailable/);
    assert.deepEqual(events.at(-1), { type: "agent_done", payload: { agent: "claude", code: 1 } });
});
