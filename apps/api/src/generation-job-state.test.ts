import { describe, expect, it } from "vitest";
import type { GenerationJob } from "@infinite-canvas/contracts";
import { transitionGenerationJob } from "./generation-job-state.js";

const job: GenerationJob = {
  id: "job-1",
  workspaceId: "workspace-1",
  ownerId: "user-1",
  capability: "image",
  logicalModelId: "image.default",
  clientRequestId: "request-1",
  attempt: 1,
  retryOf: null,
  status: "queued",
  phase: "queued",
  input: { prompt: "test" },
  result: null,
  upstreamTaskId: null,
  provider: null,
  channelId: null,
  workerId: null,
  leaseUntil: null,
  lastHeartbeatAt: null,
  nextRunAt: "2026-01-01T00:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("generation job state machine", () => {
  it("walks the reliable async generation happy path", () => {
    const claimed = transitionGenerationJob(job, "claimed");
    const submitting = transitionGenerationJob(claimed, "submitting");
    const submitted = transitionGenerationJob(submitting, "submitted", {
      upstreamTaskId: "upstream-1",
    });
    const polling = transitionGenerationJob(submitted, "polling");
    const ready = transitionGenerationJob(polling, "result_ready");
    const persisting = transitionGenerationJob(ready, "persisting");
    expect(transitionGenerationJob(persisting, "succeeded").status).toBe(
      "succeeded",
    );
  });

  it("rejects terminal transitions and changing upstream identity", () => {
    const claimed = transitionGenerationJob(job, "claimed");
    const submitting = transitionGenerationJob(claimed, "submitting");
    const submitted = transitionGenerationJob(submitting, "submitted", {
      upstreamTaskId: "upstream-1",
    });
    expect(() =>
      transitionGenerationJob(submitted, "polling", {
        upstreamTaskId: "upstream-2",
      }),
    ).toThrow(/不可变更/);
    const cancelled = transitionGenerationJob(
      transitionGenerationJob(job, "cancel_requested"),
      "cancelled",
    );
    expect(() => transitionGenerationJob(cancelled, "queued")).toThrow(
      /不能从/,
    );
  });
});
