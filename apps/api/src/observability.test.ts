import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ApiObservability, sanitizedError } from "./observability.js";

describe("API observability", () => {
  it("propagates W3C trace IDs and normalizes metric routes", async () => {
    const telemetry = new ApiObservability();
    const app = new Hono<{
      Variables: { requestId: string; traceId: string };
    }>();
    app.use("*", telemetry.middleware());
    app.get("/jobs/:jobId", (c) => c.text("ok"));
    const traceId = "0123456789abcdef0123456789abcdef";
    const response = await app.request("/jobs/private-job-id", {
      headers: {
        traceparent: `00-${traceId}-0123456789abcdef-01`,
        "x-request-id": "safe-request-id",
      },
    });
    expect(response.headers.get("x-request-id")).toBe("safe-request-id");
    expect(response.headers.get("traceparent")).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
    );
    const metrics = telemetry.render({
      queueDepth: 1,
      queueOldestAgeSeconds: 2,
      stuckJobs: 3,
      workerLastHeartbeatAgeSeconds: 4,
    });
    expect(metrics).toContain('route="/jobs/:jobId"');
    expect(metrics).not.toContain("private-job-id");
    expect(metrics).toContain("generation_stuck_jobs 3");
  });

  it("redacts common credential forms from unexpected errors", () => {
    expect(
      sanitizedError(
        new Error("authorization: Bearer-token password=hunter2 token abc"),
      ).message,
    ).not.toMatch(/Bearer-token|hunter2|token abc/);
  });
});
