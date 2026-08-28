import { randomBytes, randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

type RequestVariables = {
  requestId: string;
  traceId: string;
};

const durationBoundaries = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
type HttpMetric = { count: number; sum: number; buckets: number[] };

export class ApiObservability {
  private readonly startedAt = Date.now();
  private readonly http = new Map<string, HttpMetric>();

  middleware(): MiddlewareHandler<{ Variables: RequestVariables }> {
    return async (c, next) => {
      const startedAt = performance.now();
      const requestId = validRequestId(c.req.header("x-request-id"));
      const traceId = parseTraceId(c.req.header("traceparent"));
      c.set("requestId", requestId);
      c.set("traceId", traceId);
      c.header("x-request-id", requestId);
      c.header("traceparent", `00-${traceId}-${spanId()}-01`);
      await next();
      const durationMs = performance.now() - startedAt;
      const route = normalizedRoute(c);
      const key = `${c.req.method}\u0000${route}\u0000${c.res.status}`;
      const durationSeconds = durationMs / 1000;
      const metric = this.http.get(key) || {
        count: 0,
        sum: 0,
        buckets: durationBoundaries.map(() => 0),
      };
      metric.count++;
      metric.sum += durationSeconds;
      durationBoundaries.forEach((boundary, index) => {
        if (durationSeconds <= boundary) metric.buckets[index]!++;
      });
      this.http.set(key, metric);
      writeLog({
        level: c.res.status >= 500 ? "error" : "info",
        event: "http.request",
        method: c.req.method,
        route,
        status: c.res.status,
        durationMs: Number(durationMs.toFixed(2)),
        requestId,
        traceId,
      });
    };
  }

  render(input: {
    queueDepth: number;
    queueOldestAgeSeconds: number;
    stuckJobs: number;
    workerLastHeartbeatAgeSeconds: number;
  }) {
    const lines = [
      "# TYPE http_requests_total counter",
      "# TYPE http_request_duration_seconds histogram",
    ];
    for (const [key, metric] of [...this.http].sort()) {
      const [method, route, status] = key.split("\u0000");
      const labels = `method="${escapeLabel(method!)}",route="${escapeLabel(route!)}",status="${status}"`;
      lines.push(`http_requests_total{${labels}} ${metric.count}`);
      durationBoundaries.forEach((boundary, index) =>
        lines.push(
          `http_request_duration_seconds_bucket{${labels},le="${boundary}"} ${metric.buckets[index]}`,
        ),
      );
      lines.push(
        `http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`,
        `http_request_duration_seconds_sum{${labels}} ${metric.sum}`,
        `http_request_duration_seconds_count{${labels}} ${metric.count}`,
      );
    }
    lines.push(
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      "# TYPE generation_queue_depth gauge",
      `generation_queue_depth ${input.queueDepth}`,
      "# TYPE generation_queue_oldest_age_seconds gauge",
      `generation_queue_oldest_age_seconds ${input.queueOldestAgeSeconds}`,
      "# TYPE generation_stuck_jobs gauge",
      `generation_stuck_jobs ${input.stuckJobs}`,
      "# TYPE worker_last_heartbeat_age_seconds gauge",
      `worker_last_heartbeat_age_seconds ${input.workerLastHeartbeatAgeSeconds}`,
    );
    return `${lines.join("\n")}\n`;
  }
}

export function sanitizedError(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const raw = error instanceof Error ? error.message : "Unexpected error";
  return {
    name,
    message: raw
      .replace(
        /(bearer|token|secret|password|authorization)[=: ]+[^\s,;]+/gi,
        "$1=[REDACTED]",
      )
      .slice(0, 500),
  };
}

export function writeLog(value: Record<string, unknown>) {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...value })}\n`,
  );
}

function validRequestId(value: string | undefined) {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

function parseTraceId(value: string | undefined) {
  const match = value?.match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i);
  return match && !/^0+$/.test(match[1]!)
    ? match[1]!.toLowerCase()
    : randomBytes(16).toString("hex");
}

function spanId() {
  let value = "";
  while (!value || /^0+$/.test(value)) value = randomBytes(8).toString("hex");
  return value;
}

function normalizedRoute(c: Context) {
  return c.req.routePath || "unmatched";
}

function escapeLabel(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}
