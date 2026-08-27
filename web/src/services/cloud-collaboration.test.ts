import { describe, expect, it } from "vitest";
import { collaborationWebSocketUrl } from "./cloud-collaboration";

describe("collaborationWebSocketUrl", () => {
    it("uses secure WebSocket and encodes identifiers", () => {
        expect(collaborationWebSocketUrl("https://api.example/base", "project/a", "client b", "https://web.example/canvas")).toBe(
            "wss://api.example/api/v1/collaboration?projectId=project%2Fa&clientId=client+b",
        );
    });
    it("uses the page origin for same-origin deployments", () => {
        expect(collaborationWebSocketUrl("", "p1", "c1", "http://localhost:3000/canvas")).toBe("ws://localhost:3000/api/v1/collaboration?projectId=p1&clientId=c1");
    });
});
