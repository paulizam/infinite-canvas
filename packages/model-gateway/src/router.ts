import type {
  LogicalModel,
  LogicalModelBinding,
  ModelCapability,
  ModelChannel,
  ModelProtocol,
  ResolvedModelCandidate,
  UpstreamModel,
} from "@infinite-canvas/contracts";

export type ModelRoutingCatalog = {
  protocols: ModelProtocol[];
  channels: ModelChannel[];
  upstreamModels: UpstreamModel[];
  logicalModels: LogicalModel[];
  bindings: LogicalModelBinding[];
};

export function resolveModelCandidates(
  catalog: ModelRoutingCatalog,
  capability: ModelCapability,
  requestedModelId: string,
  options: { preferredChannelId?: string; now?: string } = {},
): ResolvedModelCandidate[] {
  const requested = requestedModelId.trim().toLowerCase();
  if (!requested) return [];
  const logical = catalog.logicalModels.find(
    (model) =>
      model.enabled &&
      model.capability === capability &&
      model.id.toLowerCase() === requested,
  );
  if (!logical) return [];
  const now = options.now || new Date().toISOString();
  return catalog.bindings
    .filter(
      (binding) => binding.enabled && binding.logicalModelId === logical.id,
    )
    .flatMap((binding): ResolvedModelCandidate[] => {
      const upstreamModel = catalog.upstreamModels.find(
        (model) => model.id === binding.upstreamModelId,
      );
      if (
        !upstreamModel ||
        !upstreamModel.enabled ||
        upstreamModel.capability !== capability ||
        upstreamModel.healthState === "disabled" ||
        (upstreamModel.healthState === "cooldown" &&
          (!upstreamModel.cooldownUntil || upstreamModel.cooldownUntil > now))
      )
        return [];
      const channel = catalog.channels.find(
        (item) => item.id === upstreamModel.channelId && item.enabled,
      );
      if (!channel?.credentialConfigured) return [];
      const protocol = catalog.protocols.find(
        (item) => item.id === channel.protocolId && item.enabled,
      );
      return protocol
        ? [{ logicalModel: logical, binding, upstreamModel, channel, protocol }]
        : [];
    })
    .sort((left, right) => {
      const preferred = options.preferredChannelId;
      const preferredOrder =
        Number(right.channel.id === preferred) -
        Number(left.channel.id === preferred);
      return (
        preferredOrder ||
        left.binding.priority - right.binding.priority ||
        right.binding.weight - left.binding.weight ||
        left.binding.id.localeCompare(right.binding.id)
      );
    });
}
