import { describe, expect, it } from "vitest";
import {
  MemoryWorkflowTriggerRepository,
  type WorkflowTriggerRecord,
} from "./workflow-trigger-repository.js";

const schedule: WorkflowTriggerRecord = {
  id: "schedule",
  workflowId: "flow",
  workflowVersion: 1,
  workspaceId: "workspace",
  createdBy: "owner",
  kind: "schedule",
  targetNodeId: "node",
  tokenHash: null,
  config: { intervalSeconds: 60 },
  enabled: true,
  nextRunAt: "2026-01-01T00:00:00.000Z",
  workerId: null,
  leaseUntil: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("Workflow trigger repository", () => {
  it("leases due schedules and permits takeover only after expiry", async () => {
    const repository = new MemoryWorkflowTriggerRepository(
      async () => undefined,
    );
    await repository.create(schedule);
    expect(
      await repository.claimSchedules({
        workerId: "one",
        now: schedule.nextRunAt!,
        leaseUntil: "2026-01-01T00:01:00.000Z",
        limit: 1,
      }),
    ).toHaveLength(1);
    expect(
      await repository.claimSchedules({
        workerId: "two",
        now: "2026-01-01T00:00:30.000Z",
        leaseUntil: "2026-01-01T00:02:00.000Z",
        limit: 1,
      }),
    ).toHaveLength(0);
    expect(
      await repository.claimSchedules({
        workerId: "two",
        now: "2026-01-01T00:01:00.000Z",
        leaseUntil: "2026-01-01T00:02:00.000Z",
        limit: 1,
      }),
    ).toHaveLength(1);
  });
});
