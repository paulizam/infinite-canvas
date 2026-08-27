import pg from "pg";
import type {
  LogicalModel,
  LogicalModelBinding,
  ModelCapability,
  ModelChannel,
  ModelProtocol,
  UpstreamModel,
} from "@infinite-canvas/contracts";
import {
  resolveModelCandidates,
  type ModelRoutingCatalog,
} from "@infinite-canvas/model-gateway";
import type { ModelGatewayRepository } from "./model-gateway-repository.js";
import { SecretCipher } from "./secret-cipher.js";

export class PostgresModelGatewayRepository implements ModelGatewayRepository {
  private readonly pool: pg.Pool;
  constructor(
    databaseUrl: string,
    private readonly cipher: SecretCipher,
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async catalog(): Promise<ModelRoutingCatalog> {
    const [protocols, channels, upstream, logical, bindings] =
      await Promise.all([
        this.pool.query("SELECT * FROM model_protocols ORDER BY id"),
        this.pool.query("SELECT * FROM model_channels ORDER BY name,id"),
        this.pool.query(
          "SELECT * FROM upstream_models ORDER BY channel_id,model_id",
        ),
        this.pool.query("SELECT * FROM logical_models ORDER BY capability,id"),
        this.pool.query(
          "SELECT * FROM logical_model_bindings ORDER BY logical_model_id,priority,weight DESC,id",
        ),
      ]);
    return {
      protocols: protocols.rows.map(mapProtocol),
      channels: channels.rows.map(mapChannel),
      upstreamModels: upstream.rows.map(mapUpstream),
      logicalModels: logical.rows.map(mapLogical),
      bindings: bindings.rows.map(mapBinding),
    };
  }
  async saveProtocol(v: ModelProtocol) {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `INSERT INTO model_protocols(id,name,adapter,enabled,config,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)
       ON CONFLICT(id) DO UPDATE SET name=$2,adapter=$3,enabled=$4,config=$5::jsonb,updated_at=$6 RETURNING *`,
      [v.id, v.name, v.adapter, v.enabled, JSON.stringify(v.config), now],
    );
    return mapProtocol(result.rows[0]);
  }
  async saveChannel(
    v: ModelChannel & { apiKey?: string; clearCredential?: boolean },
  ) {
    const existing = await this.pool.query(
      "SELECT secret_ciphertext,secret_iv,secret_tag FROM model_channels WHERE id=$1",
      [v.id],
    );
    const encrypted = v.apiKey
      ? this.cipher.encrypt(v.apiKey, v.id)
      : v.clearCredential
        ? null
        : existing.rows[0]
          ? {
              ciphertext: existing.rows[0].secret_ciphertext as Buffer,
              iv: existing.rows[0].secret_iv as Buffer,
              tag: existing.rows[0].secret_tag as Buffer,
            }
          : null;
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `INSERT INTO model_channels(id,name,protocol_id,base_url,enabled,secret_ciphertext,secret_iv,secret_tag,config,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)
       ON CONFLICT(id) DO UPDATE SET name=$2,protocol_id=$3,base_url=$4,enabled=$5,secret_ciphertext=$6,secret_iv=$7,secret_tag=$8,config=$9::jsonb,updated_at=$10 RETURNING *`,
      [
        v.id,
        v.name,
        v.protocolId,
        v.baseUrl,
        v.enabled,
        encrypted?.ciphertext || null,
        encrypted?.iv || null,
        encrypted?.tag || null,
        JSON.stringify(v.config),
        now,
      ],
    );
    return mapChannel(result.rows[0]);
  }
  async saveUpstreamModel(v: UpstreamModel) {
    const now = new Date().toISOString();
    const r = await this.pool.query(
      `INSERT INTO upstream_models(id,channel_id,model_id,capability,enabled,health_state,cooldown_until,config,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)
       ON CONFLICT(id) DO UPDATE SET channel_id=$2,model_id=$3,capability=$4,enabled=$5,health_state=$6,cooldown_until=$7,config=$8::jsonb,updated_at=$9 RETURNING *`,
      [
        v.id,
        v.channelId,
        v.modelId,
        v.capability,
        v.enabled,
        v.healthState,
        v.cooldownUntil,
        JSON.stringify(v.config),
        now,
      ],
    );
    return mapUpstream(r.rows[0]);
  }
  async saveLogicalModel(v: LogicalModel) {
    const now = new Date().toISOString();
    const r = await this.pool.query(
      `INSERT INTO logical_models(id,name,capability,enabled,is_default,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT(id) DO UPDATE SET name=$2,capability=$3,enabled=$4,is_default=$5,updated_at=$6 RETURNING *`,
      [v.id, v.name, v.capability, v.enabled, v.isDefault, now],
    );
    return mapLogical(r.rows[0]);
  }
  async saveBinding(v: LogicalModelBinding) {
    const now = new Date().toISOString();
    const r = await this.pool.query(
      `INSERT INTO logical_model_bindings(id,logical_model_id,upstream_model_id,enabled,priority,weight,capability_profile,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
       ON CONFLICT(id) DO UPDATE SET logical_model_id=$2,upstream_model_id=$3,enabled=$4,priority=$5,weight=$6,capability_profile=$7::jsonb,updated_at=$8 RETURNING *`,
      [
        v.id,
        v.logicalModelId,
        v.upstreamModelId,
        v.enabled,
        v.priority,
        v.weight,
        JSON.stringify(v.capabilityProfile),
        now,
      ],
    );
    return mapBinding(r.rows[0]);
  }
  async resolve(
    capability: ModelCapability,
    logicalModelId: string,
    preferredChannelId?: string,
  ) {
    const candidate = resolveModelCandidates(
      await this.catalog(),
      capability,
      logicalModelId,
      { preferredChannelId },
    )[0];
    if (!candidate) return null;
    const result = await this.pool.query(
      "SELECT secret_ciphertext,secret_iv,secret_tag FROM model_channels WHERE id=$1",
      [candidate.channel.id],
    );
    const row = result.rows[0];
    if (!row?.secret_ciphertext || !row.secret_iv || !row.secret_tag)
      return null;
    return {
      ...candidate,
      apiKey: this.cipher.decrypt(
        {
          ciphertext: row.secret_ciphertext as Buffer,
          iv: row.secret_iv as Buffer,
          tag: row.secret_tag as Buffer,
        },
        candidate.channel.id,
      ),
    };
  }
}
function mapProtocol(r: Record<string, unknown>): ModelProtocol {
  return {
    id: String(r.id),
    name: String(r.name),
    adapter: r.adapter as ModelProtocol["adapter"],
    enabled: Boolean(r.enabled),
    config: r.config as Record<string, unknown>,
  };
}
function mapChannel(r: Record<string, unknown>): ModelChannel {
  return {
    id: String(r.id),
    name: String(r.name),
    protocolId: String(r.protocol_id),
    baseUrl: String(r.base_url),
    enabled: Boolean(r.enabled),
    credentialConfigured: Boolean(r.secret_ciphertext),
    config: r.config as Record<string, unknown>,
  };
}
function mapUpstream(r: Record<string, unknown>): UpstreamModel {
  return {
    id: String(r.id),
    channelId: String(r.channel_id),
    modelId: String(r.model_id),
    capability: r.capability as UpstreamModel["capability"],
    enabled: Boolean(r.enabled),
    healthState: r.health_state as UpstreamModel["healthState"],
    cooldownUntil: r.cooldown_until ? iso(r.cooldown_until) : null,
    config: r.config as Record<string, unknown>,
  };
}
function mapLogical(r: Record<string, unknown>): LogicalModel {
  return {
    id: String(r.id),
    name: String(r.name),
    capability: r.capability as LogicalModel["capability"],
    enabled: Boolean(r.enabled),
    isDefault: Boolean(r.is_default),
  };
}
function mapBinding(r: Record<string, unknown>): LogicalModelBinding {
  return {
    id: String(r.id),
    logicalModelId: String(r.logical_model_id),
    upstreamModelId: String(r.upstream_model_id),
    enabled: Boolean(r.enabled),
    priority: Number(r.priority),
    weight: Number(r.weight),
    capabilityProfile:
      r.capability_profile as LogicalModelBinding["capabilityProfile"],
  };
}
function iso(v: unknown) {
  return v instanceof Date ? v.toISOString() : String(v);
}
