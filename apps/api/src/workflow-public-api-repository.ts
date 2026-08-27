import { DomainError } from "./domain.js";

export type WorkflowApiScope = "invoke" | "read_execution";
export type WorkflowApiTokenRecord = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  workspaceId: string;
  createdBy: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: WorkflowApiScope[];
  rateLimitPerMinute: number;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};
export type WorkflowApiInvocation = {
  id: string;
  tokenId: string;
  idempotencyKey: string;
  executionId: string;
  createdAt: string;
};
export type WorkflowApiAuditEvent = {
  id: string;
  tokenId: string;
  tokenName: string;
  action: WorkflowApiScope;
  executionId: string | null;
  requestId: string | null;
  createdAt: string;
};

export interface WorkflowPublicApiRepository {
  create(record: WorkflowApiTokenRecord): Promise<WorkflowApiTokenRecord>;
  list(userId: string, workflowId: string): Promise<WorkflowApiTokenRecord[]>;
  revoke(
    userId: string,
    tokenId: string,
    now: string,
  ): Promise<WorkflowApiTokenRecord>;
  rotate(
    userId: string,
    tokenId: string,
    replacement: Pick<
      WorkflowApiTokenRecord,
      "id" | "tokenPrefix" | "tokenHash" | "createdAt"
    >,
  ): Promise<WorkflowApiTokenRecord>;
  getByHash(tokenHash: string): Promise<WorkflowApiTokenRecord | null>;
  reserve(
    input: WorkflowApiInvocation & { maxPerMinute: number },
  ): Promise<{ invocation: WorkflowApiInvocation; replayed: boolean }>;
  audit(input: {
    id: string;
    tokenId: string;
    action: WorkflowApiScope;
    executionId?: string;
    requestId?: string;
    createdAt: string;
  }): Promise<void>;
  listAudit(
    userId: string,
    workflowId: string,
    limit: number,
  ): Promise<WorkflowApiAuditEvent[]>;
}

export class MemoryWorkflowPublicApiRepository implements WorkflowPublicApiRepository {
  private readonly tokens = new Map<string, WorkflowApiTokenRecord>();
  private readonly invocations = new Map<string, WorkflowApiInvocation>();
  readonly audits: WorkflowApiAuditEvent[] = [];
  constructor(
    private readonly authorize: (
      userId: string,
      workspaceId: string,
      minimum: "viewer" | "editor",
    ) => Promise<void>,
  ) {}
  async create(record: WorkflowApiTokenRecord) {
    await this.authorize(record.createdBy, record.workspaceId, "editor");
    this.tokens.set(record.id, structuredClone(record));
    return structuredClone(record);
  }
  async list(userId: string, workflowId: string) {
    const values = [...this.tokens.values()].filter(
      (value) => value.workflowId === workflowId,
    );
    if (values[0])
      await this.authorize(userId, values[0].workspaceId, "viewer");
    return values
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((value) => structuredClone(value));
  }
  async revoke(userId: string, tokenId: string, now: string) {
    const token = this.tokens.get(tokenId);
    if (!token)
      throw new DomainError(
        "WORKFLOW_API_TOKEN_NOT_FOUND",
        404,
        "API token 不存在",
      );
    await this.authorize(userId, token.workspaceId, "editor");
    token.revokedAt ||= now;
    return structuredClone(token);
  }
  async rotate(
    userId: string,
    tokenId: string,
    replacement: Pick<
      WorkflowApiTokenRecord,
      "id" | "tokenPrefix" | "tokenHash" | "createdAt"
    >,
  ) {
    const token = this.tokens.get(tokenId);
    if (!token || token.revokedAt)
      throw new DomainError(
        "WORKFLOW_API_TOKEN_NOT_FOUND",
        404,
        "API token 不存在",
      );
    await this.authorize(userId, token.workspaceId, "editor");
    token.revokedAt = replacement.createdAt;
    const next = {
      ...structuredClone(token),
      ...replacement,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.tokens.set(next.id, next);
    return structuredClone(next);
  }
  async getByHash(tokenHash: string) {
    const token = [...this.tokens.values()].find(
      (value) => value.tokenHash === tokenHash && !value.revokedAt,
    );
    return token ? structuredClone(token) : null;
  }
  async reserve(input: WorkflowApiInvocation & { maxPerMinute: number }) {
    const key = `${input.tokenId}\0${input.idempotencyKey}`;
    const existing = this.invocations.get(key);
    if (existing)
      return { invocation: structuredClone(existing), replayed: true };
    const since = new Date(Date.parse(input.createdAt) - 60_000).toISOString();
    const count = [...this.invocations.values()].filter(
      (value) => value.tokenId === input.tokenId && value.createdAt > since,
    ).length;
    if (count >= input.maxPerMinute)
      throw new DomainError(
        "WORKFLOW_API_RATE_LIMITED",
        429,
        "Workflow API 调用过于频繁",
      );
    const invocation = {
      id: input.id,
      tokenId: input.tokenId,
      idempotencyKey: input.idempotencyKey,
      executionId: input.executionId,
      createdAt: input.createdAt,
    };
    this.invocations.set(key, invocation);
    return { invocation: structuredClone(invocation), replayed: false };
  }
  async audit(input: {
    id?: string;
    tokenId: string;
    action: WorkflowApiScope;
    executionId?: string;
    requestId?: string;
    createdAt?: string;
  }) {
    const token = this.tokens.get(input.tokenId)!;
    this.audits.push({
      id: input.id || crypto.randomUUID(),
      tokenId: input.tokenId,
      tokenName: token.name,
      action: input.action,
      executionId: input.executionId || null,
      requestId: input.requestId || null,
      createdAt: input.createdAt || new Date().toISOString(),
    });
  }
  async listAudit(userId: string, workflowId: string, limit: number) {
    const matching = [...this.tokens.values()].filter(
      (value) => value.workflowId === workflowId,
    );
    if (matching[0])
      await this.authorize(userId, matching[0].workspaceId, "viewer");
    const ids = new Set(matching.map((value) => value.id));
    return this.audits
      .filter((value) => ids.has(value.tokenId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((value) => structuredClone(value));
  }
}

export function publicWorkflowApiToken(record: WorkflowApiTokenRecord) {
  const { tokenHash: _tokenHash, ...value } = record;
  return value;
}
