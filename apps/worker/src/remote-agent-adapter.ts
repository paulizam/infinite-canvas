import {
  AGENT_TOOL_CONTRACT_VERSION,
  agentCoreTools,
  type AgentRemoteResult,
  type AgentRemoteToolCall,
  type RemoteAgentTurnRequest,
  type RemoteAgentTurnResponse,
} from "@infinite-canvas/contracts";
import { createHash } from "node:crypto";
import type { AgentRunHandler } from "./agent-runtime.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RESULT_KINDS = new Set([
  "text",
  "image",
  "video",
  "audio",
  "asset",
  "drama_item",
]);
const EVENT_TYPES = new Set([
  "status",
  "output.delta",
  "tool.started",
  "tool.completed",
]);

export type RemoteAgentAdapterOptions = {
  url: string;
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

/** 将持久 Agent Run 委派给团队 Agent 服务，同时只在 Worker 租约内执行共享工具。 */
export function createRemoteTeamAgentHandler(
  options: RemoteAgentAdapterOptions,
): AgentRunHandler {
  const endpoint = remoteEndpoint(options.url);
  const token = options.token.trim();
  if (token.length < 32)
    throw new Error("REMOTE_AGENT_TOKEN must contain at least 32 characters");
  const fetcher = options.fetcher || fetch;
  return async (detail, client, workerId, signal) => {
    const run = detail.run;
    try {
      const started = detail.events.some(
        (event) => record(event).type === "run.started",
      );
      if (!started)
        await client.transitionAgentRun(
          workerId,
          run.id,
          {
            type: "run.start",
            plan: { steps: [{ id: "remote", title: "Remote team Agent" }] },
          },
          signal,
        );
      const context = await client.getAgentToolContext(
        workerId,
        run.id,
        signal,
      );
      const approvals = detail.approvals.map((value) => ({
        action: String(record(value).action || ""),
        status: String(record(value).status || ""),
      }));
      const request: RemoteAgentTurnRequest = {
        contractVersion: AGENT_TOOL_CONTRACT_VERSION,
        idempotencyKey: idempotencyKey(run.id, run.attempt, approvals),
        run: {
          id: run.id,
          workspaceId: run.workspaceId,
          prompt: run.prompt,
          attachments: run.attachments,
          modelId: run.modelId,
          parameters: run.parameters,
          skillPolicy: run.skillPolicy,
          attempt: run.attempt,
        },
        context,
        tools: agentCoreTools,
        approvals,
      };
      const response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: combinedSignal(signal, options.timeoutMs || 120_000),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          "x-agent-contract-version": String(AGENT_TOOL_CONTRACT_VERSION),
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok)
        throw coded(
          "REMOTE_AGENT_HTTP_ERROR",
          `Remote Agent failed with HTTP ${response.status}`,
        );
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        throw coded(
          "REMOTE_AGENT_INVALID_RESPONSE",
          "Remote Agent response must be application/json",
        );
      const output = parseResponse(await boundedText(response));
      for (const event of output.events || [])
        await client.transitionAgentRun(
          workerId,
          run.id,
          { type: "event.append", eventType: event.type, data: event.data },
          signal,
        );

      if (output.approval) {
        await client.transitionAgentRun(
          workerId,
          run.id,
          {
            type: "approval.request",
            action: output.approval.action,
            request: output.approval.request,
          },
          signal,
        );
        return;
      }
      const required = requiredApproval(output, approvals);
      if (required) {
        await client.transitionAgentRun(
          workerId,
          run.id,
          {
            type: "approval.request",
            action: required.action,
            request: required.request,
          },
          signal,
        );
        return;
      }
      for (const call of output.toolCalls || []) {
        await client.transitionAgentRun(
          workerId,
          run.id,
          {
            type: "subtask.upsert",
            subtask: {
              id: call.id,
              kind: "tool",
              title: call.name,
              status: "running",
              input: call.input,
            },
          },
          signal,
        );
        const applied = await client.executeAgentTool(
          workerId,
          run.id,
          call,
          signal,
        );
        await client.transitionAgentRun(
          workerId,
          run.id,
          {
            type: "subtask.upsert",
            subtask: {
              id: call.id,
              kind: "tool",
              title: call.name,
              status: "succeeded",
              output: {
                revision: applied.project.document.revision,
                replayed: applied.replayed,
              },
            },
          },
          signal,
        );
      }
      for (const result of output.results || [])
        await addResult(client, workerId, run.id, result, signal);
      if (output.finalText?.trim())
        await addResult(
          client,
          workerId,
          run.id,
          {
            id: stableUuid(`${run.id}:final`),
            kind: "text",
            payload: { text: output.finalText.trim() },
          },
          signal,
        );
      if (!output.done)
        throw coded(
          "REMOTE_AGENT_INCOMPLETE",
          "Remote Agent response is neither complete nor waiting for approval",
        );
      await client.transitionAgentRun(
        workerId,
        run.id,
        { type: "run.complete" },
        signal,
      );
    } catch (error) {
      const value = error as Error & { code?: string };
      await client
        .transitionAgentRun(
          workerId,
          run.id,
          {
            type: "run.fail",
            error: {
              code: value.code || "REMOTE_AGENT_ERROR",
              message: String(value.message || "Remote Agent failed").slice(
                0,
                500,
              ),
            },
          },
          signal,
        )
        .catch(() => undefined);
    }
  };
}

async function addResult(
  client: Parameters<AgentRunHandler>[1],
  workerId: string,
  runId: string,
  result: AgentRemoteResult,
  signal?: AbortSignal,
) {
  await client.transitionAgentRun(
    workerId,
    runId,
    { type: "result.add", result },
    signal,
  );
}

function remoteEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("REMOTE_AGENT_URL is invalid");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "REMOTE_AGENT_URL must be HTTPS without credentials, query, or fragment",
    );
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/agent/turns`;
  return url.toString();
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES)
    throw coded(
      "REMOTE_AGENT_RESPONSE_TOO_LARGE",
      "Remote Agent response exceeds 2 MiB",
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
    throw coded(
      "REMOTE_AGENT_RESPONSE_TOO_LARGE",
      "Remote Agent response exceeds 2 MiB",
    );
  return text;
}

function parseResponse(text: string): RemoteAgentTurnResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw coded(
      "REMOTE_AGENT_INVALID_RESPONSE",
      "Remote Agent returned invalid JSON",
    );
  }
  const root = record(value);
  const events = array(root.events, 100).map((item) => {
    const event = record(item);
    const type = String(event.type || "");
    if (!EVENT_TYPES.has(type))
      throw coded(
        "REMOTE_AGENT_INVALID_RESPONSE",
        "Remote Agent event type is invalid",
      );
    return {
      type: type as NonNullable<
        RemoteAgentTurnResponse["events"]
      >[number]["type"],
      data: record(event.data),
    };
  });
  const toolCalls = array(root.toolCalls, 50).map(parseToolCall);
  const results = array(root.results, 50).map((item) => {
    const result = record(item);
    const kind = String(result.kind || "");
    if (
      !RESULT_KINDS.has(kind) ||
      typeof result.id !== "string" ||
      !UUID_PATTERN.test(result.id)
    )
      throw coded(
        "REMOTE_AGENT_INVALID_RESPONSE",
        "Remote Agent result id or kind is invalid",
      );
    return {
      id: result.id,
      kind: kind as AgentRemoteResult["kind"],
      payload: record(result.payload),
      ...(typeof result.assetId === "string"
        ? { assetId: result.assetId }
        : {}),
    };
  });
  const approvalValue =
    root.approval === undefined ? undefined : record(root.approval);
  const approval = approvalValue
    ? {
        action: approvalAction(approvalValue.action),
        request: record(approvalValue.request),
      }
    : undefined;
  return {
    ...(root.plan && typeof root.plan === "object"
      ? { plan: root.plan as RemoteAgentTurnResponse["plan"] }
      : {}),
    events,
    toolCalls,
    results,
    ...(approval ? { approval } : {}),
    ...(typeof root.finalText === "string"
      ? { finalText: root.finalText.slice(0, 1_000_000) }
      : {}),
    done: root.done === true,
  };
}

function parseToolCall(value: unknown): AgentRemoteToolCall {
  const call = record(value),
    input = record(call.input);
  if (
    typeof call.id !== "string" ||
    !call.id ||
    call.id.length > 160 ||
    call.name !== "canvas_apply_ops" ||
    !Number.isSafeInteger(call.expectedRevision) ||
    Number(call.expectedRevision) < 0
  )
    throw coded(
      "REMOTE_AGENT_INVALID_RESPONSE",
      "Remote Agent tool call is invalid",
    );
  const ops = array(input.ops, 200);
  if (
    !ops.length ||
    ops.some((operation) => typeof record(operation).type !== "string")
  )
    throw coded(
      "REMOTE_AGENT_INVALID_RESPONSE",
      "Remote Agent Canvas operations are invalid",
    );
  return {
    id: call.id,
    name: "canvas_apply_ops",
    input: { ops: ops as AgentRemoteToolCall["input"]["ops"] },
    expectedRevision: Number(call.expectedRevision),
  };
}

function requiredApproval(
  output: RemoteAgentTurnResponse,
  approvals: Array<{ action: string; status: string }>,
) {
  const approved = (action: string) =>
    approvals.some(
      (value) => value.action === action && value.status === "approved",
    );
  const destructive = output.toolCalls?.find((call) =>
    call.input.ops.some(
      (operation) =>
        operation.type === "delete_node" ||
        operation.type === "delete_connections",
    ),
  );
  if (destructive && !approved("delete"))
    return {
      action: "delete" as const,
      request: {
        toolCallId: destructive.id,
        tool: destructive.name,
        input: destructive.input,
      },
    };
  const batch =
    output.results?.filter(
      (result) =>
        ["image", "video", "audio"].includes(result.kind) &&
        Number(result.payload.count || 1) > 1,
    ) || [];
  if (batch.length && !approved("batch_paid_generation"))
    return {
      action: "batch_paid_generation" as const,
      request: { resultIds: batch.map((result) => result.id) },
    };
  const external =
    output.results?.filter(
      (result) =>
        typeof result.payload.externalUrl === "string" ||
        (typeof result.payload.url === "string" &&
          /^https?:\/\//i.test(result.payload.url)),
    ) || [];
  if (external.length && !approved("external_access"))
    return {
      action: "external_access" as const,
      request: { resultIds: external.map((result) => result.id) },
    };
  return null;
}

function array(value: unknown, max: number) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max)
    throw coded(
      "REMOTE_AGENT_INVALID_RESPONSE",
      "Remote Agent array field is invalid",
    );
  return value;
}
function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function approvalAction(
  value: unknown,
): "delete" | "batch_paid_generation" | "external_access" {
  if (
    value !== "delete" &&
    value !== "batch_paid_generation" &&
    value !== "external_access"
  )
    throw coded(
      "REMOTE_AGENT_INVALID_RESPONSE",
      "Remote Agent approval action is invalid",
    );
  return value;
}
function idempotencyKey(
  runId: string,
  attempt: number,
  approvals: Array<{ action: string; status: string }>,
) {
  return `${runId}:${attempt}:${
    approvals
      .map((value) => `${value.action}=${value.status}`)
      .sort()
      .join(",") || "initial"
  }`;
}
function combinedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  return parent
    ? AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}
function coded(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function stableUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
