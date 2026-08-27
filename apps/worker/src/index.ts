import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkerApiClient } from "./client.js";
import { runWorker } from "./runtime.js";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const workerId =
  process.env.WORKER_ID?.trim() ||
  `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const client = new WorkerApiClient(
  required("WORKER_API_ORIGIN"),
  required("WORKER_TOKEN"),
);
console.log(`Generation worker started: ${workerId}`);
await runWorker({ client, workerId, signal: controller.signal });
console.log(`Generation worker stopped: ${workerId}`);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
