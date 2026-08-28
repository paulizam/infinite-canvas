export type ModelCapability = "text" | "image" | "video" | "audio";
export type ModelProtocolAdapter =
  | "openai-compatible"
  | "gemini"
  | "seedance"
  | "stable-diffusion"
  | "media-kit"
  | "volcengine"
  | "custom";
export type ModelHealthState = "healthy" | "degraded" | "cooldown" | "disabled";

export type ModelProtocol = {
  id: string;
  name: string;
  adapter: ModelProtocolAdapter;
  enabled: boolean;
  config: Record<string, unknown>;
};

export type ModelChannel = {
  id: string;
  name: string;
  protocolId: string;
  baseUrl: string;
  enabled: boolean;
  credentialConfigured: boolean;
  config: Record<string, unknown>;
};

export type ModelCapabilityProfile = {
  supportsReferenceImage?: boolean;
  supportsReferenceVideo?: boolean;
  supportsReferenceAudio?: boolean;
  maxReferenceImages?: number;
  aspectRatios?: string[];
  resolutions?: string[];
  durationSeconds?: number[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  maxBatchSize?: number;
  supportsAsync?: boolean;
  supportsCancel?: boolean;
  supportsWebhook?: boolean;
  timeoutMs?: number;
  concurrencyLimit?: number;
};

export type UpstreamModel = {
  id: string;
  channelId: string;
  modelId: string;
  capability: ModelCapability;
  enabled: boolean;
  healthState: ModelHealthState;
  cooldownUntil: string | null;
  config: Record<string, unknown>;
};

export type LogicalModelBinding = {
  id: string;
  logicalModelId: string;
  upstreamModelId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  capabilityProfile: ModelCapabilityProfile;
};

export type LogicalModel = {
  id: string;
  name: string;
  capability: ModelCapability;
  enabled: boolean;
  isDefault: boolean;
};

export type ResolvedModelCandidate = {
  logicalModel: LogicalModel;
  binding: LogicalModelBinding;
  upstreamModel: UpstreamModel;
  channel: ModelChannel;
  protocol: ModelProtocol;
};
