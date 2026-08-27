import type { AssetRef, GenerationCapability, GenerationJob } from "@infinite-canvas/contracts";

import type { CloudPlatformClient } from "./cloud-platform";

type GenerationRequest = {
    workspaceId: string;
    capability: GenerationCapability;
    logicalModelId: string;
    clientRequestId: string;
    parameters: Record<string, unknown>;
};

type WaitOptions = {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (job: GenerationJob) => void;
    onTextDelta?: (text: string) => void;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

export class CloudGenerationError extends Error {
    constructor(
        message: string,
        public readonly job: GenerationJob,
    ) {
        super(message);
    }
}

export async function createAndWaitForGeneration(client: CloudPlatformClient, request: GenerationRequest, options: WaitOptions = {}) {
    throwIfAborted(options.signal);
    const created = await client.createGenerationJob(
        request.workspaceId,
        {
            capability: request.capability,
            logicalModelId: request.logicalModelId,
            clientRequestId: request.clientRequestId,
            parameters: request.parameters,
        },
        options.signal,
    );
    try {
        if (request.capability === "text" && options.onTextDelta && "openGenerationEvents" in client) {
            try {
                await consumeGenerationEvents(client, created.job.id, options.onTextDelta, options.signal);
                const finalJob = await client.getGenerationJob(created.job.id, options.signal);
                if (isTerminal(finalJob)) return ensureSucceeded(finalJob);
            } catch (error) {
                if (isAbortError(error) || options.signal?.aborted) {
                    await client.cancelGenerationJob(created.job.id).catch(() => undefined);
                    throw abortError();
                }
                // Event delivery is an optimization; authoritative polling remains the fallback.
            }
        }
        return await waitForGeneration(client, created.job, options);
    } finally {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("cloud-billing-changed"));
    }
}

async function consumeGenerationEvents(client: CloudPlatformClient, jobId: string, onTextDelta: (text: string) => void, signal?: AbortSignal) {
    const response = await client.openGenerationEvents(jobId, 0, signal);
    if (!response.body) throw new Error("Generation event stream has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
        fullText = "";
    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
            if (!data) continue;
            const event = JSON.parse(data) as { type?: string; payload?: { delta?: unknown } };
            if (event.type === "text.delta" && typeof event.payload?.delta === "string") {
                fullText += event.payload.delta;
                onTextDelta(fullText);
            }
            if (event.type === "job.terminal") return;
        }
        if (done) return;
    }
}

function ensureSucceeded(job: GenerationJob) {
    if (job.phase !== "succeeded") throw new CloudGenerationError(job.errorMessage || `Cloud generation ended as ${job.phase}`, job);
    return job;
}

export async function waitForGeneration(client: CloudPlatformClient, initial: GenerationJob, options: WaitOptions = {}) {
    const interval = options.pollIntervalMs ?? 1_500;
    const timeout = options.timeoutMs ?? 10 * 60_000;
    const sleep = options.sleep ?? abortableSleep;
    const startedAt = Date.now();
    let job = initial;
    options.onUpdate?.(job);
    while (!isTerminal(job)) {
        try {
            throwIfAborted(options.signal);
            if (Date.now() - startedAt >= timeout) throw new CloudGenerationError("Cloud generation timed out", job);
            await sleep(interval, options.signal);
            job = await client.getGenerationJob(job.id, options.signal);
            options.onUpdate?.(job);
        } catch (error) {
            if (isAbortError(error) || options.signal?.aborted) {
                await client.cancelGenerationJob(job.id).catch(() => undefined);
                throw abortError();
            }
            throw error;
        }
    }
    if (job.phase !== "succeeded") {
        throw new CloudGenerationError(job.errorMessage || `Cloud generation ended as ${job.phase}`, job);
    }
    return job;
}

export function generationAssets(job: GenerationJob): AssetRef[] {
    const assets = job.result?.assets;
    if (!Array.isArray(assets)) return [];
    return assets.filter((asset): asset is AssetRef => Boolean(asset) && typeof asset === "object" && typeof (asset as Record<string, unknown>).assetId === "string");
}

export function generationText(job: GenerationJob) {
    const result = job.result;
    if (!result) return "";
    if (typeof result.text === "string") return result.text;
    if (typeof result.output_text === "string") return result.output_text;
    const choices = Array.isArray(result.choices) ? result.choices : [];
    const first = choices[0];
    if (!first || typeof first !== "object") return "";
    const message = (first as Record<string, unknown>).message;
    if (!message || typeof message !== "object") return "";
    const content = (message as Record<string, unknown>).content;
    return typeof content === "string" ? content : "";
}

function isTerminal(job: GenerationJob) {
    return ["succeeded", "failed", "cancelled", "needs_review"].includes(job.phase);
}

function abortableSleep(milliseconds: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, milliseconds);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(abortError());
            },
            { once: true },
        );
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
}

function abortError() {
    return new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}
