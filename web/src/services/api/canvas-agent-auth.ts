export const AGENT_TOKEN_HEADER = "x-canvas-agent-token";

export function withAgentAuth(token: string, init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers);
    headers.set(AGENT_TOKEN_HEADER, token);
    return { ...init, headers };
}
