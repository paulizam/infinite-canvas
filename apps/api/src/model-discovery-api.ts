import { Hono } from "hono";
import type { PublicUser } from "./domain.js";
import type { ModelDiscoveryService } from "./model-discovery.js";
import type { ModelGatewayRepository } from "./model-gateway-repository.js";

type DiscoveryEnv = {
  Variables: { user: PublicUser; sessionToken: string; requestId: string };
};

export function createModelDiscoveryApi(
  service: ModelDiscoveryService,
  repository: ModelGatewayRepository,
) {
  const app = new Hono<DiscoveryEnv>();
  app.post("/:id/test", async (c) => {
    const result = await discoverChannel(
      service,
      repository,
      c.req.param("id"),
    );
    return c.json({
      data: {
        ok: true,
        latencyMs: result.latencyMs,
        modelCount: result.models.length,
      },
      requestId: c.get("requestId"),
    });
  });
  app.post("/:id/discover", async (c) =>
    c.json({
      data: await discoverChannel(service, repository, c.req.param("id")),
      requestId: c.get("requestId"),
    }),
  );
  return app;
}

async function discoverChannel(
  service: ModelDiscoveryService,
  repository: ModelGatewayRepository,
  channelId: string,
) {
  try {
    const result = await service.discover(channelId);
    await reportChannelDiscovery(repository, channelId, "success");
    return result;
  } catch (error) {
    await reportChannelDiscovery(repository, channelId, "failure");
    throw error;
  }
}

async function reportChannelDiscovery(
  repository: ModelGatewayRepository,
  channelId: string,
  outcome: "success" | "failure",
) {
  const catalog = await repository.catalog();
  const now = new Date().toISOString();
  await Promise.all(
    catalog.upstreamModels
      .filter((model) => model.channelId === channelId)
      .map((model) => repository.reportHealth(model.id, outcome, now)),
  );
}
