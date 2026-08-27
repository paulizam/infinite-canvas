import type { AssetRef } from "@infinite-canvas/contracts";

import { cloudPlatform, type CloudPlatformClient } from "./cloud-platform";
import type { ReferenceImage } from "@/types/image";

const uploaded = new Map<string, Promise<AssetRef>>();

export async function uploadCloudReferenceImages(workspaceId: string, references: ReferenceImage[], signal?: AbortSignal, client: CloudPlatformClient = cloudPlatform) {
    return Promise.all(references.map((reference) => uploadImageReference(workspaceId, reference, signal, client)));
}

async function uploadImageReference(workspaceId: string, reference: ReferenceImage, signal: AbortSignal | undefined, client: CloudPlatformClient) {
    const cacheKey = `${workspaceId}\u0000${reference.storageKey || reference.dataUrl}`;
    const cached = uploaded.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
        const stored = reference.storageKey ? await import("./image-storage").then(({ getImageBlob }) => getImageBlob(reference.storageKey!)) : null;
        const blob = stored || (await fetch(reference.dataUrl, { signal }).then(checkedBlob));
        if (!blob) throw new Error("Reference image is missing from local storage");
        const result = await client.uploadAsset(workspaceId, blob, reference.name, signal);
        return { assetId: result.asset.id, mimeType: result.asset.mimeType } satisfies AssetRef;
    })();
    uploaded.set(cacheKey, pending);
    return clearFailed(cacheKey, pending);
}

export async function uploadCloudMediaReference(workspaceId: string, reference: { name: string; url: string; storageKey?: string }, signal?: AbortSignal, client: CloudPlatformClient = cloudPlatform) {
    const cacheKey = `${workspaceId}\u0000${reference.storageKey || reference.url}`;
    const cached = uploaded.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
        const stored = reference.storageKey ? await import("./file-storage").then(({ getMediaBlob }) => getMediaBlob(reference.storageKey!)) : null;
        const blob = stored || (await fetch(reference.url, { signal }).then(checkedBlob));
        if (!blob) throw new Error("Reference media is missing from local storage");
        const result = await client.uploadAsset(workspaceId, blob, reference.name, signal);
        return { assetId: result.asset.id, mimeType: result.asset.mimeType } satisfies AssetRef;
    })();
    uploaded.set(cacheKey, pending);
    return clearFailed(cacheKey, pending);
}

async function clearFailed(cacheKey: string, pending: Promise<AssetRef>) {
    try {
        return await pending;
    } catch (error) {
        uploaded.delete(cacheKey);
        throw error;
    }
}

async function checkedBlob(response: Response) {
    if (!response.ok) throw new Error(`Reference download failed with HTTP ${response.status}`);
    return response.blob();
}

export function clearCloudReferenceCache() {
    uploaded.clear();
}
