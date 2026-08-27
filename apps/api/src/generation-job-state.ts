import type {
  GenerationJob,
  GenerationJobPhase,
  GenerationJobStatus,
} from "@infinite-canvas/contracts";
import { DomainError } from "./domain.js";

const TRANSITIONS: Record<
  GenerationJobPhase,
  ReadonlySet<GenerationJobPhase>
> = {
  queued: new Set(["claimed", "cancel_requested"]),
  claimed: new Set(["queued", "submitting", "cancel_requested"]),
  submitting: new Set([
    "submitted",
    "failed",
    "needs_review",
    "cancel_requested",
  ]),
  submitted: new Set([
    "polling",
    "result_ready",
    "failed",
    "needs_review",
    "cancel_requested",
  ]),
  polling: new Set([
    "polling",
    "result_ready",
    "failed",
    "needs_review",
    "cancel_requested",
  ]),
  result_ready: new Set(["persisting", "failed", "needs_review"]),
  persisting: new Set(["succeeded", "failed", "needs_review"]),
  cancel_requested: new Set(["cancelled", "needs_review"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  needs_review: new Set(),
};

const STATUS_BY_PHASE: Record<GenerationJobPhase, GenerationJobStatus> = {
  queued: "queued",
  claimed: "running",
  submitting: "running",
  submitted: "running",
  polling: "running",
  result_ready: "running",
  persisting: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancel_requested: "running",
  cancelled: "cancelled",
  needs_review: "needs_review",
};

export type GenerationJobTransitionPatch = Partial<
  Pick<
    GenerationJob,
    | "upstreamTaskId"
    | "provider"
    | "channelId"
    | "result"
    | "workerId"
    | "leaseUntil"
    | "lastHeartbeatAt"
    | "nextRunAt"
    | "errorCode"
    | "errorMessage"
  >
>;

export function transitionGenerationJob(
  job: GenerationJob,
  phase: GenerationJobPhase,
  patch: GenerationJobTransitionPatch = {},
  now = new Date().toISOString(),
): GenerationJob {
  if (!TRANSITIONS[job.phase].has(phase))
    throw new DomainError(
      "INVALID_JOB_TRANSITION",
      409,
      `生成任务不能从 ${job.phase} 转为 ${phase}`,
    );
  if (
    job.upstreamTaskId &&
    patch.upstreamTaskId &&
    patch.upstreamTaskId !== job.upstreamTaskId
  )
    throw new DomainError(
      "UPSTREAM_TASK_IMMUTABLE",
      409,
      "同一 attempt 的上游任务标识不可变更",
    );
  return {
    ...job,
    ...patch,
    phase,
    status: STATUS_BY_PHASE[phase],
    updatedAt: now,
  };
}

export function isTerminalGenerationPhase(phase: GenerationJobPhase) {
  return (
    phase === "succeeded" ||
    phase === "failed" ||
    phase === "cancelled" ||
    phase === "needs_review"
  );
}
