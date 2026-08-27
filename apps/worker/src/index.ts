import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkerApiClient } from "./client.js";
import { runWorker } from "./runtime.js";
import { createRemoteTeamAgentHandler } from "./remote-agent-adapter.js";

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
const remoteAgentUrl = process.env.REMOTE_AGENT_URL?.trim();
const agentHandler = remoteAgentUrl
  ? createRemoteTeamAgentHandler({
      url: remoteAgentUrl,
      token: required("REMOTE_AGENT_TOKEN"),
    })
  : undefined;
await runWorker({ client, workerId, agentHandler, signal: controller.signal });
console.log(`Generation worker stopped: ${workerId}`);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
