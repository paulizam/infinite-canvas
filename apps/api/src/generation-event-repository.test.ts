import { describe, expect, it } from "vitest";
import { MemoryGenerationEventRepository } from "./generation-event-repository.js";

describe("generation event repository", () => {
  it("assigns monotonic per-job ids and replays strictly after the cursor", async () => {
    const repository = new MemoryGenerationEventRepository();
    await repository.append(
      "job-a",
      "text.delta",
      { delta: "a" },
      "2026-01-01T00:00:00.000Z",
    );
    await repository.append(
      "job-a",
      "text.delta",
      { delta: "b" },
      "2026-01-01T00:00:01.000Z",
    );
    const other = await repository.append(
      "job-b",
      "text.delta",
      { delta: "x" },
      "2026-01-01T00:00:02.000Z",
    );
    expect(other.id).toBe(1);
    await expect(
      repository.listForUser("owner", "job-a", 1, 100),
    ).resolves.toMatchObject([{ id: 2, payload: { delta: "b" } }]);
  });
  it("enforces replay limits", async () => {
    const repository = new MemoryGenerationEventRepository();
    for (let index = 0; index < 3; index++)
      await repository.append(
        "job",
        "text.delta",
        { delta: String(index) },
        new Date().toISOString(),
      );
    await expect(
      repository.listForUser("owner", "job", 0, 2),
    ).resolves.toHaveLength(2);
  });
});
