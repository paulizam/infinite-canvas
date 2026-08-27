import type {
  LogicalModel,
  LogicalModelBinding,
  ModelCapability,
  ModelChannel,
  ModelProtocol,
  ResolvedModelCandidate,
  UpstreamModel,
} from "@infinite-canvas/contracts";
import type { ModelRoutingCatalog } from "@infinite-canvas/model-gateway";

export type InternalResolvedModel = ResolvedModelCandidate & { apiKey: string };
export interface ModelGatewayRepository {
  catalog(): Promise<ModelRoutingCatalog>;
  saveProtocol(value: ModelProtocol): Promise<ModelProtocol>;
  saveChannel(
    value: ModelChannel & { apiKey?: string; clearCredential?: boolean },
  ): Promise<ModelChannel>;
  saveUpstreamModel(value: UpstreamModel): Promise<UpstreamModel>;
  saveLogicalModel(value: LogicalModel): Promise<LogicalModel>;
  saveBinding(value: LogicalModelBinding): Promise<LogicalModelBinding>;
  resolve(
    capability: ModelCapability,
    logicalModelId: string,
    preferredChannelId?: string,
  ): Promise<InternalResolvedModel | null>;
}

export class MemoryModelGatewayRepository implements ModelGatewayRepository {
  private protocols = new Map<string, ModelProtocol>();
  private channels = new Map<string, ModelChannel>();
  private upstreamModels = new Map<string, UpstreamModel>();
  private logicalModels = new Map<string, LogicalModel>();
  private bindings = new Map<string, LogicalModelBinding>();
  private secrets = new Map<string, string>();
  async catalog() {
    return {
      protocols: [...this.protocols.values()],
      channels: [...this.channels.values()],
      upstreamModels: [...this.upstreamModels.values()],
      logicalModels: [...this.logicalModels.values()],
      bindings: [...this.bindings.values()],
    };
  }
  async saveProtocol(value: ModelProtocol) {
    this.protocols.set(value.id, value);
    return value;
  }
  async saveChannel(
    value: ModelChannel & { apiKey?: string; clearCredential?: boolean },
  ) {
    if (value.clearCredential) this.secrets.delete(value.id);
    else if (value.apiKey) this.secrets.set(value.id, value.apiKey);
    const { apiKey: _, clearCredential: __, ...publicValue } = value;
    const stored = {
      ...publicValue,
      credentialConfigured: this.secrets.has(value.id),
    };
    this.channels.set(value.id, stored);
    return stored;
  }
  async saveUpstreamModel(value: UpstreamModel) {
    this.upstreamModels.set(value.id, value);
    return value;
  }
  async saveLogicalModel(value: LogicalModel) {
    this.logicalModels.set(value.id, value);
    return value;
  }
  async saveBinding(value: LogicalModelBinding) {
    this.bindings.set(value.id, value);
    return value;
  }
  async resolve(
    capability: ModelCapability,
    logicalModelId: string,
    preferredChannelId?: string,
  ) {
    const { resolveModelCandidates } =
      await import("@infinite-canvas/model-gateway");
    const candidate = resolveModelCandidates(
      await this.catalog(),
      capability,
      logicalModelId,
      { preferredChannelId },
    )[0];
    const apiKey = candidate && this.secrets.get(candidate.channel.id);
    return candidate && apiKey ? { ...candidate, apiKey } : null;
  }
}
