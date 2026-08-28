const MAX_EVENT_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 2_000_000;
export const MAX_SSE_BYTES = 64 * 1024 * 1024;

export type ProviderDelta = {
  text?: string;
  reasoning?: string;
  usage?: Record<string, unknown>;
};

export async function consumeAndPersistTextStream(input: {
  response: Response;
  adapter: "openai-compatible" | "gemini";
  client: {
    appendEvent(
      workerId: string,
      jobId: string,
      type: "text.delta" | "text.reasoning.delta",
      delta: string,
      signal?: AbortSignal,
    ): Promise<unknown>;
  };
  workerId: string;
  jobId: string;
  signal?: AbortSignal;
}) {
  let text = "",
    reasoning = "",
    pendingText = "",
    pendingReasoning = "",
    lastFlush = Date.now();
  const flush = async (force = false) => {
    if (
      !force &&
      pendingText.length + pendingReasoning.length < 1024 &&
      Date.now() - lastFlush < 75
    )
      return;
    if (pendingText) {
      await input.client.appendEvent(
        input.workerId,
        input.jobId,
        "text.delta",
        pendingText,
        input.signal,
      );
      pendingText = "";
    }
    if (pendingReasoning) {
      await input.client.appendEvent(
        input.workerId,
        input.jobId,
        "text.reasoning.delta",
        pendingReasoning,
        input.signal,
      );
      pendingReasoning = "";
    }
    lastFlush = Date.now();
  };
  const streamed = await consumeProviderSse(
    input.response,
    input.adapter,
    async (delta) => {
      if (delta.text) {
        text += delta.text;
        pendingText += delta.text;
      }
      if (delta.reasoning) {
        reasoning += delta.reasoning;
        pendingReasoning += delta.reasoning;
      }
      await flush();
    },
  );
  await flush(true);
  if (!text) throw new Error("Provider stream returned no text");
  return {
    text,
    ...(reasoning ? { reasoning } : {}),
    ...(streamed.usage ? { usage: streamed.usage } : {}),
  };
}

export async function consumeProviderSse(
  response: Response,
  adapter: "openai-compatible" | "gemini",
  onDelta: (delta: ProviderDelta) => Promise<void>,
) {
  if (!response.body)
    throw new Error("Provider streaming response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytesRead = 0;
  let total = 0;
  let usage: Record<string, unknown> | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > MAX_SSE_BYTES)
          throw new Error("Provider SSE response exceeds limit");
      }
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      if (buffer.length > MAX_EVENT_BYTES && !buffer.includes("\n\n"))
        throw new Error("Provider SSE event exceeds limit");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame.length > MAX_EVENT_BYTES)
          throw new Error("Provider SSE event exceeds limit");
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          throw new Error("Provider returned malformed SSE JSON");
        }
        const delta =
          adapter === "gemini" ? geminiDelta(payload) : openAiDelta(payload);
        total += (delta.text?.length || 0) + (delta.reasoning?.length || 0);
        if (total > MAX_TEXT_CHARS)
          throw new Error("Provider streamed text exceeds limit");
        if (delta.usage) usage = delta.usage;
        if (delta.text || delta.reasoning) await onDelta(delta);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim())
    throw new Error("Provider SSE ended with an incomplete event");
  return { usage };
}

function openAiDelta(payload: Record<string, unknown>): ProviderDelta {
  const choice =
    Array.isArray(payload.choices) &&
    payload.choices[0] &&
    typeof payload.choices[0] === "object"
      ? (payload.choices[0] as Record<string, unknown>)
      : undefined;
  const delta =
    choice?.delta && typeof choice.delta === "object"
      ? (choice.delta as Record<string, unknown>)
      : undefined;
  return {
    text: stringValue(delta?.content),
    reasoning: stringValue(delta?.reasoning_content ?? delta?.reasoning),
    usage: objectValue(payload.usage),
  };
}
function geminiDelta(payload: Record<string, unknown>): ProviderDelta {
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];
  const text = candidates
    .flatMap((candidate) => {
      const content = objectValue(objectValue(candidate)?.content);
      return Array.isArray(content?.parts) ? content.parts : [];
    })
    .map((part) => stringValue(objectValue(part)?.text))
    .filter(Boolean)
    .join("");
  return { text: text || undefined, usage: objectValue(payload.usageMetadata) };
}
function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}
