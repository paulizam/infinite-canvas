import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import { planWorkflowExecution } from "./planner.js";
import type {
  WorkflowExecutionState,
  WorkflowNodeExecution,
  WorkflowSkipReason,
} from "./execution-types.js";

export function createWorkflowExecution(input: {
  id: string;
  definition: WorkflowDefinition;
  workflowVersion: number;
  now: string;
  startNodeIds?: string[];
  initialInputs?: Record<string, unknown>;
  maxAttempts?: number;
}): WorkflowExecutionState {
  const plan = planWorkflowExecution(input.definition, input.startNodeIds);
  const selected = new Set(plan.selectedNodeIds);
  const skipped = new Map(
    plan.skipped.map((item) => [item.nodeId, item.reason] as const),
  );
  const nodes = Object.fromEntries(
    input.definition.nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        status: selected.has(node.id) ? "pending" : "skipped",
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 3,
        ...(skipped.has(node.id) ? { skipReason: skipped.get(node.id) } : {}),
        steps: {},
      } satisfies WorkflowNodeExecution,
    ]),
  );
  const state: WorkflowExecutionState = {
    id: input.id,
    workflowId: input.definition.id,
    workflowVersion: input.workflowVersion,
    status: "queued",
    selectedNodeIds: plan.selectedNodeIds,
    layers: plan.layers,
    initialInputs: structuredClone(input.initialInputs || {}),
    nodes,
    events: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  emit(state, "execution.created", input.now);
  refresh(state, input.definition, input.now);
  return state;
}

export function startWorkflowNode(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  input: unknown,
  now: string,
) {
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (state.status === "cancel_requested" || state.status === "cancelled")
    throw new Error("Execution is cancelling");
  if (node.status !== "ready") throw new Error(`Node is not ready: ${nodeId}`);
  node.status = "running";
  if (!node.startedAt) node.attempt += 1;
  if (input !== undefined) node.input = input;
  node.startedAt = now;
  state.status = "running";
  emit(state, "node.started", now, nodeId, { attempt: node.attempt });
  refresh(state, definition, now);
  return state;
}

export function completeWorkflowNode(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  output: unknown,
  now: string,
) {
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (node.status !== "running" && node.status !== "waiting")
    throw new Error(`Node is not active: ${nodeId}`);
  node.status = "succeeded";
  node.output = output;
  node.completedAt = now;
  delete node.wakeAt;
  delete node.eventKey;
  emit(state, "node.succeeded", now, nodeId);
  refresh(state, definition, now);
  return state;
}

export function failWorkflowNode(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  error: { code: string; message: string },
  now: string,
  retryAt?: string,
) {
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (node.status !== "running" && node.status !== "waiting")
    throw new Error(`Node is not active: ${nodeId}`);
  node.error = error;
  if (node.attempt < node.maxAttempts && retryAt) {
    node.status = "waiting";
    node.wakeAt = retryAt;
    node.startedAt = undefined;
    emit(state, "node.retry_scheduled", now, nodeId, {
      attempt: node.attempt + 1,
      retryAt,
    });
  } else {
    node.status = "failed";
    node.completedAt = now;
    emit(state, "node.failed", now, nodeId, { code: error.code });
  }
  refresh(state, definition, now);
  return state;
}

export function waitWorkflowNode(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  now: string,
  wait: { wakeAt?: string; eventKey?: string },
) {
  if (Boolean(wait.wakeAt) === Boolean(wait.eventKey))
    throw new Error("Exactly one wait target is required");
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (node.status !== "running")
    throw new Error(`Node is not running: ${nodeId}`);
  node.status = "waiting";
  node.wakeAt = wait.wakeAt;
  node.eventKey = wait.eventKey;
  emit(
    state,
    wait.wakeAt ? "node.sleeping" : "node.event_waiting",
    now,
    nodeId,
    wait,
  );
  refresh(state, definition, now);
  return state;
}

export function resumeWorkflowExecution(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  now: string,
  eventKey?: string,
) {
  const state = copy(source);
  for (const node of Object.values(state.nodes)) {
    if (node.status !== "waiting") continue;
    const due = node.wakeAt && node.wakeAt <= now;
    const signalled = eventKey && node.eventKey === eventKey;
    if (!due && !signalled) continue;
    node.status = "ready";
    for (const step of Object.values(node.steps))
      if (
        step.status === "waiting" &&
        ((step.wakeAt && step.wakeAt <= now) ||
          (eventKey && step.eventKey === eventKey))
      ) {
        step.status = "running";
        if (step.error) {
          step.attempt += 1;
          step.startedAt = now;
          delete step.error;
        }
        delete step.wakeAt;
        delete step.eventKey;
      }
    delete node.wakeAt;
    delete node.eventKey;
    emit(
      state,
      signalled ? "node.event_received" : "node.woke",
      now,
      node.nodeId,
    );
  }
  refresh(state, definition, now);
  return state;
}

export function skipWorkflowNode(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  reason: Exclude<WorkflowSkipReason, "before_selection">,
  now: string,
) {
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (node.status !== "ready" && node.status !== "pending")
    throw new Error(`Node cannot be skipped: ${nodeId}`);
  node.status = "skipped";
  node.skipReason = reason;
  node.completedAt = now;
  emit(state, "node.skipped", now, nodeId, { reason });
  refresh(state, definition, now);
  return state;
}

export function startWorkflowStep(
  source: WorkflowExecutionState,
  nodeId: string,
  key: string,
  input: unknown,
  now: string,
  maxAttempts = 3,
) {
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (node.status !== "running")
    throw new Error(`Node is not running: ${nodeId}`);
  const existing = node.steps[key];
  if (existing?.status === "succeeded" || existing?.status === "running")
    return state;
  if (existing?.status === "waiting")
    throw new Error(`Step is waiting: ${key}`);
  node.steps[key] = {
    key,
    status: "running",
    attempt: (existing?.attempt || 0) + 1,
    maxAttempts: existing?.maxAttempts || maxAttempts,
    input,
    startedAt: now,
  };
  emit(state, "step.started", now, nodeId, {
    stepKey: key,
    attempt: node.steps[key].attempt,
  });
  state.updatedAt = now;
  return state;
}

export function completeWorkflowStep(
  source: WorkflowExecutionState,
  nodeId: string,
  key: string,
  output: unknown,
  now: string,
) {
  const state = copy(source),
    step = requireStep(state, nodeId, key);
  if (step.status === "succeeded") return state;
  if (step.status !== "running") throw new Error(`Step is not running: ${key}`);
  step.status = "succeeded";
  step.output = output;
  step.completedAt = now;
  emit(state, "step.succeeded", now, nodeId, { stepKey: key });
  state.updatedAt = now;
  return state;
}

export function waitWorkflowStep(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  key: string,
  now: string,
  wait: { wakeAt?: string; eventKey?: string },
) {
  if (Boolean(wait.wakeAt) === Boolean(wait.eventKey))
    throw new Error("Exactly one wait target is required");
  const state = copy(source),
    node = requireNode(state, nodeId),
    step = requireStep(state, nodeId, key);
  if (node.status !== "running" || step.status !== "running")
    throw new Error(`Step is not active: ${key}`);
  step.status = "waiting";
  step.wakeAt = wait.wakeAt;
  step.eventKey = wait.eventKey;
  node.status = "waiting";
  node.wakeAt = wait.wakeAt;
  node.eventKey = wait.eventKey;
  emit(
    state,
    wait.wakeAt ? "step.sleeping" : "step.event_waiting",
    now,
    nodeId,
    { stepKey: key, ...wait },
  );
  refresh(state, definition, now);
  return state;
}

export function failWorkflowStep(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  key: string,
  error: { code: string; message: string },
  now: string,
  retryAt?: string,
) {
  const state = copy(source),
    node = requireNode(state, nodeId),
    step = requireStep(state, nodeId, key);
  if (step.status !== "running") throw new Error(`Step is not running: ${key}`);
  step.error = error;
  if (step.attempt < step.maxAttempts && retryAt) {
    step.status = "waiting";
    step.wakeAt = retryAt;
    node.status = "waiting";
    node.wakeAt = retryAt;
    emit(state, "step.retry_scheduled", now, nodeId, {
      stepKey: key,
      retryAt,
    });
  } else {
    step.status = "failed";
    step.completedAt = now;
    node.status = "failed";
    node.error = error;
    node.completedAt = now;
    emit(state, "step.failed", now, nodeId, {
      stepKey: key,
      code: error.code,
    });
  }
  refresh(state, definition, now);
  return state;
}

export function cancelWorkflowExecution(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  now: string,
) {
  const state = copy(source);
  if (state.status === "cancelled") return state;
  if (state.status === "succeeded" || state.status === "failed")
    throw new Error(`Terminal execution cannot be cancelled: ${state.status}`);
  for (const node of Object.values(state.nodes))
    if (["pending", "ready", "waiting"].includes(node.status)) {
      node.status = "cancelled";
      node.completedAt = now;
    }
  state.status = Object.values(state.nodes).some(
    (node) => node.status === "running",
  )
    ? "cancel_requested"
    : "cancelled";
  emit(state, "execution.cancel_requested", now);
  refresh(state, definition, now);
  return state;
}

export function completeWorkflowCancellation(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  now: string,
) {
  const state = copy(source);
  if (state.status === "cancelled") return state;
  if (state.status !== "cancel_requested")
    throw new Error("Execution cancellation was not requested");
  for (const node of Object.values(state.nodes))
    if (["pending", "ready", "running", "waiting"].includes(node.status)) {
      node.status = "cancelled";
      node.completedAt = now;
    }
  refresh(state, definition, now);
  return state;
}

export function retryWorkflowNode(
  source: WorkflowExecutionState,
  definition: WorkflowDefinition,
  nodeId: string,
  now: string,
) {
  const state = copy(source),
    node = requireNode(state, nodeId);
  if (node.status !== "failed")
    throw new Error(`Node is not failed: ${nodeId}`);
  node.status = "ready";
  node.completedAt = undefined;
  node.error = undefined;
  node.maxAttempts = Math.max(node.maxAttempts, node.attempt + 1);
  node.startedAt = undefined;
  state.completedAt = undefined;
  emit(state, "node.retry_requested", now, nodeId);
  refresh(state, definition, now);
  return state;
}

function refresh(
  state: WorkflowExecutionState,
  definition: WorkflowDefinition,
  now: string,
) {
  if (state.status === "cancelled") {
    state.updatedAt = now;
    return;
  }
  const selected = new Set(state.selectedNodeIds);
  let changed: boolean;
  do {
    changed = false;
    for (const nodeId of state.selectedNodeIds) {
      const node = state.nodes[nodeId]!;
      if (node.status !== "pending") continue;
      const incoming = definition.edges.filter(
        (edge) => edge.toNodeId === nodeId && selected.has(edge.fromNodeId),
      );
      const predecessors = incoming.map(
        (edge) => state.nodes[edge.fromNodeId]!,
      );
      if (
        !predecessors.every((item) =>
          ["succeeded", "skipped", "failed"].includes(item.status),
        )
      )
        continue;
      if (
        !incoming.length ||
        incoming.some((edge) => edgeCarriesValue(state, definition, edge))
      )
        node.status = "ready";
      else {
        const upstreamFailed = predecessors.some(
          (item) =>
            item.status === "failed" || item.skipReason === "upstream_skipped",
        );
        node.status = "skipped";
        node.skipReason = upstreamFailed
          ? "upstream_skipped"
          : "condition_false";
        node.completedAt = now;
        emit(state, "node.skipped", now, nodeId, {
          reason: node.skipReason,
          blockedBy: incoming.map((edge) => edge.fromNodeId),
        });
      }
      changed = true;
    }
  } while (changed);
  const nodes = state.selectedNodeIds.map((id) => state.nodes[id]!);
  if (state.status === "cancel_requested") {
    if (!nodes.some((node) => node.status === "running"))
      finish(state, "cancelled", now);
  } else if (nodes.some((node) => node.status === "failed"))
    finish(state, "failed", now);
  else if (
    nodes.length &&
    nodes.every(
      (node) => node.status === "succeeded" || node.status === "skipped",
    )
  )
    finish(state, "succeeded", now);
  else if (nodes.some((node) => node.status === "running"))
    state.status = "running";
  else if (nodes.some((node) => node.status === "waiting"))
    state.status = "waiting";
  else state.status = "queued";
  state.updatedAt = now;
}

function edgeCarriesValue(
  state: WorkflowExecutionState,
  definition: WorkflowDefinition,
  edge: WorkflowDefinition["edges"][number],
) {
  const source = state.nodes[edge.fromNodeId];
  if (source?.status !== "succeeded" || source.output === undefined)
    return false;
  if (isRecord(source.output))
    return Object.hasOwn(source.output, edge.fromPortId);
  const sourceDefinition = definition.nodes.find(
    (node) => node.id === edge.fromNodeId,
  );
  return (
    sourceDefinition?.outputs.length === 1 &&
    sourceDefinition.outputs[0]?.id === edge.fromPortId
  );
}

function finish(
  state: WorkflowExecutionState,
  status: "succeeded" | "failed" | "cancelled",
  now: string,
) {
  if (state.status !== status) emit(state, `execution.${status}`, now);
  state.status = status;
  state.completedAt = now;
}
function emit(
  state: WorkflowExecutionState,
  type: string,
  createdAt: string,
  nodeId?: string,
  data?: Record<string, unknown>,
) {
  const stepKey = typeof data?.stepKey === "string" ? data.stepKey : undefined;
  state.events.push({
    sequence: state.events.length + 1,
    type,
    createdAt,
    ...(nodeId ? { nodeId } : {}),
    ...(stepKey ? { stepKey } : {}),
    ...(data ? { data } : {}),
  });
}
function requireNode(state: WorkflowExecutionState, nodeId: string) {
  const node = state.nodes[nodeId];
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  return node;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function requireStep(
  state: WorkflowExecutionState,
  nodeId: string,
  key: string,
) {
  const step = requireNode(state, nodeId).steps[key];
  if (!step) throw new Error(`Unknown step: ${key}`);
  return step;
}
function copy(state: WorkflowExecutionState): WorkflowExecutionState {
  return structuredClone(state);
}
