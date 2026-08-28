import { useEffect, useState } from "react";

import { fetchAgentResource, isAgentMessageAssetUrl } from "@/services/api/canvas-agent";

export type AgentMediaUrl = { url: string; revoke: () => void };

export async function loadAgentMediaUrl(endpoint: string, token: string, source: string): Promise<AgentMediaUrl> {
    if (!isAgentMessageAssetUrl(endpoint, source)) return { url: source, revoke: () => undefined };
    const path = source.slice(endpoint.trim().replace(/\/$/, "").length);
    const response = await fetchAgentResource(endpoint, token, path);
    if (!response.ok) throw new Error(`Agent media request failed (${response.status})`);
    const url = URL.createObjectURL(await response.blob());
    return { url, revoke: () => URL.revokeObjectURL(url) };
}

export function useAgentMediaUrl(endpoint: string, token: string, source: string) {
    const [url, setUrl] = useState(() => (isAgentMessageAssetUrl(endpoint, source) ? "" : source));
    useEffect(() => {
        let disposed = false;
        let revoke: () => void = () => undefined;
        setUrl(isAgentMessageAssetUrl(endpoint, source) ? "" : source);
        void loadAgentMediaUrl(endpoint, token, source)
            .then((media) => {
                if (disposed) return media.revoke();
                revoke = media.revoke;
                setUrl(media.url);
            })
            .catch(() => {
                if (!disposed) setUrl("");
            });
        return () => {
            disposed = true;
            revoke();
        };
    }, [endpoint, source, token]);
    return url;
}
