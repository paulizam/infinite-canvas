import { describe, expect, it } from "vitest";
import { createWorkflowExecution } from "@infinite-canvas/workflow-runtime";
import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import {
  MemoryWorkflowExecutionRepository,
  type WorkflowExecutionRecord,
} from "./workflow-execution-repository.js";

const definition: WorkflowDefinition = {
  id: "flow",
  schemaVersion: 1,
  name: "Flow",
  nodes: [{ id: "a", type: "test", inputs: [], outputs: [], config: {} }],
  edges: [],
};
const record = (id: string, nextRunAt: string): WorkflowExecutionRecord => ({
  state: createWorkflowExecution({
    id,
    definition,
    workflowVersion: 1,
    now: "2026-01-01T00:00:00.000Z",
  }),
  revision: 0,
  workspaceId: "workspace",
  createdBy: "owner",
  definition,
  workerId: null,
  leaseUntil: null,
  nextRunAt,
});

describe("Workflow execution leases", () => {
  it("lists visible workflow history newest first with a hard limit", async () => {
    const repository = new MemoryWorkflowExecutionRepository(
      async () => undefined,
    );
    const older = record("older", "2026-01-01T00:00:00.000Z");
    const newer = record("newer", "2026-01-01T00:00:00.000Z");
    newer.state.createdAt = "2026-01-02T00:00:00.000Z";
    await repository.create(older);
    await repository.create(newer);
    expect(
      (await repository.list("owner", "flow", 1)).map((item) => item.state.id),
    ).toEqual(["newer"]);
  });

  it("claims due work deterministically and permits takeover only after expiry", async () => {
    const repository = new MemoryWorkflowExecutionRepository(
      async () => undefined,
    );
    await repository.create(record("b", "2026-01-01T00:00:01.000Z"));
    await repository.create(record("a", "2026-01-01T00:00:01.000Z"));
    const first = await repository.claim({
      workerId: "one",
      now: "2026-01-01T00:00:01.000Z",
      leaseUntil: "2026-01-01T00:01:00.000Z",
      limit: 1,
    });
    expect(first.map((item) => item.state.id)).toEqual(["a"]);
    expect(
      await repository.getForWorker("two", "a", "2026-01-01T00:00:02.000Z"),
    ).toBeNull();
    expect(
      await repository.claim({
        workerId: "two",
        now: "2026-01-01T00:00:02.000Z",
        leaseUntil: "2026-01-01T00:02:00.000Z",
        limit: 2,
      }),
    ).toHaveLength(1);
    expect(
      (
        await repository.claim({
          workerId: "two",
          now: "2026-01-01T00:01:00.000Z",
          leaseUntil: "2026-01-01T00:02:00.000Z",
          limit: 2,
        })
      ).map((item) => item.state.id),
    ).toEqual(["a"]);
  });

  it("renews active ownership and rejects stale worker writes", async () => {
    const repository = new MemoryWorkflowExecutionRepository(
      async () => undefined,
    );
    await repository.create(record("run", "2026-01-01T00:00:00.000Z"));
    const [claimed] = await repository.claim({
      workerId: "one",
      now: "2026-01-01T00:00:00.000Z",
      leaseUntil: "2026-01-01T00:00:10.000Z",
      limit: 1,
    });
    expect(
      await repository.heartbeat(
        "one",
        ["run", "run"],
        "2026-01-01T00:00:05.000Z",
        "2026-01-01T00:00:20.000Z",
      ),
    ).toBe(1);
    await expect(
      repository.saveByWorker(
        "two",
        claimed!,
        0,
        "2026-01-01T00:00:06.000Z",
        "2026-01-01T00:00:06.000Z",
      ),
    ).rejects.toMatchObject({ code: "EXECUTION_LEASE_LOST" });
    await expect(
      repository.saveByWorker(
        "one",
        claimed!,
        0,
        "2026-01-01T00:00:21.000Z",
        "2026-01-01T00:00:21.000Z",
      ),
    ).rejects.toMatchObject({ code: "EXECUTION_LEASE_LOST" });
  });
});
