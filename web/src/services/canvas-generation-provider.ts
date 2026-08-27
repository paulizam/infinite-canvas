import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "./api/image";
import { requestAudioGeneration } from "./api/audio";
import { requestVideoGeneration, type VideoGenerationResult } from "./api/video";
import { runCloudMediaGeneration, runCloudTextGeneration } from "./cloud-canvas-generation";
import { cloudModeEnabled } from "./cloud-platform";
import { uploadCloudMediaReference, uploadCloudReferenceImages } from "./cloud-reference-assets";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type GenerationOptions = { workspaceId: string | null; signal?: AbortSignal };

export function generationConfigReady(localReady: boolean) {
    return cloudModeEnabled || localReady;
}

export async function generateCanvasImage(config: AiConfig, prompt: string, references: ReferenceImage[], options: GenerationOptions, mask?: ReferenceImage): Promise<string | Blob> {
    if (!cloudModeEnabled)
        return references.length ? requestEdit(config, prompt, references, mask, { signal: options.signal }).then((items) => items[0].dataUrl) : requestGeneration(config, prompt, { signal: options.signal }).then((items) => items[0].dataUrl);
    const workspaceId = requireWorkspace(options.workspaceId);
    const images = await uploadCloudReferenceImages(workspaceId, references, options.signal);
    const masks = mask ? await uploadCloudReferenceImages(workspaceId, [mask], options.signal) : [];
    return runCloudMediaGeneration({
        workspaceId,
        capability: "image",
        requestedModel: config.model,
        parameters: { prompt, images, ...(masks[0] ? { mask: masks[0] } : {}), count: 1, size: config.size, resolution: config.size, quality: config.quality },
        signal: options.signal,
    }).then((items) => items[0]);
}

export async function generateCanvasVideo(config: AiConfig, prompt: string, references: { images: ReferenceImage[]; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] }, options: GenerationOptions): Promise<VideoGenerationResult> {
    if (!cloudModeEnabled) return requestVideoGeneration(config, prompt, references.images, { signal: options.signal });
    const workspaceId = requireWorkspace(options.workspaceId);
    const [images, videos, audios] = await Promise.all([
        uploadCloudReferenceImages(workspaceId, references.images, options.signal),
        Promise.all((references.videos || []).map((reference) => uploadCloudMediaReference(workspaceId, reference, options.signal))),
        Promise.all((references.audios || []).map((reference) => uploadCloudMediaReference(workspaceId, reference, options.signal))),
    ]);
    const blob = await runCloudMediaGeneration({
        workspaceId,
        capability: "video",
        requestedModel: config.model,
        parameters: {
            prompt,
            images,
            videos,
            audios,
            durationSeconds: Number(config.videoSeconds),
            seconds: config.videoSeconds,
            size: config.size,
            resolution: config.vquality,
            generateAudio: config.videoGenerateAudio === "true",
            watermark: config.videoWatermark === "true",
        },
        signal: options.signal,
    }).then((items) => items[0]);
    return { blob };
}

export async function generateCanvasAudio(config: AiConfig, prompt: string, options: GenerationOptions) {
    if (!cloudModeEnabled) return requestAudioGeneration(config, prompt, { signal: options.signal });
    const workspaceId = requireWorkspace(options.workspaceId);
    return runCloudMediaGeneration({
        workspaceId,
        capability: "audio",
        requestedModel: config.model,
        parameters: { input: prompt, prompt, voice: config.audioVoice, response_format: config.audioFormat, speed: Number(config.audioSpeed), instructions: config.audioInstructions },
        signal: options.signal,
    }).then((items) => items[0]);
}

export async function generateCanvasText(config: AiConfig, prompt: string, messages: AiTextMessage[], references: ReferenceImage[], onDelta: (text: string) => void, options: GenerationOptions) {
    if (!cloudModeEnabled) return requestImageQuestion(config, messages, onDelta, { signal: options.signal });
    const workspaceId = requireWorkspace(options.workspaceId);
    const assets = await uploadCloudReferenceImages(workspaceId, references, options.signal);
    const systemPrompt = (config.systemPrompt || "").trim();
    const userMessage = assets.length ? { role: "user", content: [{ type: "text", text: prompt }, ...assets.map((asset) => ({ type: "image_url", image_url: { url: asset } }))] } : { role: "user", content: prompt };
    const cloudMessages = [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), userMessage];
    return runCloudTextGeneration({
        workspaceId,
        capability: "text",
        requestedModel: config.model,
        parameters: {
            prompt,
            messages: cloudMessages,
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            reasoning_effort: config.reasoningEffort,
        },
        signal: options.signal,
        onTextDelta: onDelta,
    });
}

function requireWorkspace(workspaceId: string | null) {
    if (!workspaceId) throw new Error("Cloud workspace is not available");
    return workspaceId;
}
