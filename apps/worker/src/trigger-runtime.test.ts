import { describe, expect, it, vi } from "vitest";
import { runScheduleTriggerCycle } from "./trigger-runtime.js";

describe("schedule trigger worker", () => {
  it("claims and dispatches leased schedules", async () => {
    const client = {
      claimScheduleTriggers: vi.fn(async () => [
        {
          id: "trigger/a",
          kind: "schedule",
          nextRunAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
      dispatchScheduleTrigger: vi.fn(async () => undefined),
    };
    expect(
      await runScheduleTriggerCycle({
        client: client as never,
        workerId: "worker",
        limit: 5,
        leaseMs: 90_000,
      }),
    ).toBe(1);
    expect(client.dispatchScheduleTrigger).toHaveBeenCalledWith(
      "worker",
      "trigger/a",
      undefined,
    );
  });
});
