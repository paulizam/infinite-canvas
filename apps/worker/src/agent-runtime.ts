import { WorkerApiClient, type WorkerResolvedModel } from "./client.js";
import type { AgentWorkerRun } from "./agent-types.js";
import {
  buildSubmitRequest,
  buildStreamingSubmitRequest,
  normalizePayload,
  redactProviderError,
  safeJson,
} from "./provider-runtime.js";
import { consumeProviderSse } from "./provider-sse.js";

export type AgentRunHandler = (
  run: AgentWorkerRun,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
) => Promise<unknown>;

export async function runAgentCycle(input: {
  client: WorkerApiClient;
  workerId: string;
  limit: number;
  leaseMs: number;
  handler?: AgentRunHandler;
  signal?: AbortSignal;
}) {
  const runs = await input.client.claimAgentRuns(
    input.workerId,
    input.limit,
    input.leaseMs,
    input.signal,
  );
  const heartbeat = setInterval(
    () =>
      void input.client
        .heartbeatAgentRuns(
          input.workerId,
          runs.map((value) => value.run.id),
          input.leaseMs,
          input.signal,
        )
        .catch((error) =>
          console.error(
            "agent worker heartbeat failed",
            error instanceof Error ? error.message : error,
          ),
        ),
    Math.max(5_000, Math.floor(input.leaseMs / 3)),
  );
  heartbeat.unref?.();
  try {
    const handler = input.handler || createAgentModelHandler();
    await Promise.all(
      runs.map((run) =>
        handler(run, input.client, input.workerId, input.signal),
      ),
    );
  } finally {
    clearInterval(heartbeat);
  }
  return runs.length;
}

export function createAgentModelHandler(
  fetcher: typeof fetch = fetch,
): AgentRunHandler {
  return async (detail, client, workerId, signal) => {
    const { run } = detail;
    let resolved: WorkerResolvedModel | null = null;
    try {
      if (
        detail.events.some(
          (event) =>
            event &&
            typeof event === "object" &&
            (event as { type?: unknown }).type === "run.started",
        )
      )
        throw coded(
          "AGENT_AMBIGUOUS_RECOVERY",
          "A previous Provider attempt may have started; retry explicitly to avoid duplicate billing",
        );
      if (!run.modelId)
        throw coded(
          "AGENT_MODEL_REQUIRED",
          "Agent Run requires a logical text model",
        );
      if (run.attachments.length || allowedSkills(run.skillPolicy).length)
        throw coded(
          "REMOTE_AGENT_ADAPTER_REQUIRED",
          "Attachments and executable Skills require a remote Agent adapter",
        );
      await client.transitionAgentRun(
        workerId,
        run.id,
        {
          type: "run.start",
          plan: { steps: [{ id: "respond", title: "Generate response" }] },
        },
        signal,
      );
      resolved = await client.resolveModel(
        "text",
        run.modelId,
        undefined,
        signal,
      );
      const parameters = {
        ...run.parameters,
        prompt: run.prompt,
        ...(Array.isArray(run.parameters.messages)
          ? {}
          : { messages: [{ role: "user", content: run.prompt }] }),
      };
      const request = buildStreamingSubmitRequest(resolved, parameters);
      if (!request) {
        const fallback = buildSubmitRequest(resolved, "text", parameters);
        const response = await fetcher(fallback.url, {
          ...fallback.init,
          signal,
        });
        if (!response.ok)
          throw new Error(
            `Provider submit failed with HTTP ${response.status}`,
          );
        const payload = normalizePayload(
          resolved,
          await safeJson(response),
          "text",
        );
        await finish(
          textFromPayload(payload),
          run.id,
          client,
          workerId,
          signal,
        );
      } else {
        const response = await fetcher(request.url, {
          ...request.init,
          signal,
        });
        if (!response.ok)
          throw new Error(
            `Provider submit failed with HTTP ${response.status}`,
          );
        let text = "",
          pending = "";
        await consumeProviderSse(
          response,
          resolved.protocol.adapter as "openai-compatible" | "gemini",
          async (delta) => {
            if (!delta.text) return;
            text += delta.text;
            pending += delta.text;
            if (pending.length >= 1024) {
              await client.transitionAgentRun(
                workerId,
                run.id,
                {
                  type: "event.append",
                  eventType: "output.delta",
                  data: { text: pending },
                },
                signal,
              );
              pending = "";
            }
          },
        );
        if (pending)
          await client.transitionAgentRun(
            workerId,
            run.id,
            {
              type: "event.append",
              eventType: "output.delta",
              data: { text: pending },
            },
            signal,
          );
        await finish(text, run.id, client, workerId, signal);
      }
      await client
        .reportModelHealth(resolved.upstreamModel.id, "success", signal)
        .catch(() => undefined);
    } catch (error) {
      if (resolved)
        await client
          .reportModelHealth(resolved.upstreamModel.id, "failure", signal)
          .catch(() => undefined);
      const value = error as Error & { code?: string };
      await client
        .transitionAgentRun(
          workerId,
          run.id,
          {
            type: "run.fail",
            error: {
              code: value.code || "AGENT_EXECUTION_ERROR",
              message: redactProviderError(
                value.message || "Agent execution failed",
              ).slice(0, 500),
            },
          },
          signal,
        )
        .catch(() => undefined);
    }
  };
}

async function finish(
  text: string,
  runId: string,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
) {
  if (!text.trim())
    throw coded("EMPTY_AGENT_RESULT", "Provider returned no visible text");
  await client.transitionAgentRun(
    workerId,
    runId,
    { type: "result.add", result: { kind: "text", payload: { text } } },
    signal,
  );
  await client.transitionAgentRun(
    workerId,
    runId,
    { type: "run.complete" },
    signal,
  );
}
function allowedSkills(policy: Record<string, unknown>) {
  return Array.isArray(policy.allow)
    ? policy.allow.filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      )
    : [];
}
function textFromPayload(payload: Record<string, unknown>) {
  if (typeof payload.text === "string") return payload.text;
  const choice =
    Array.isArray(payload.choices) &&
    payload.choices[0] &&
    typeof payload.choices[0] === "object"
      ? (payload.choices[0] as Record<string, unknown>)
      : null;
  const message =
    choice?.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : null;
  return typeof message?.content === "string" ? message.content : "";
}
function coded(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
