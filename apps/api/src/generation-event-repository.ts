import type {
  GenerationEvent,
  GenerationEventType,
} from "@infinite-canvas/contracts";

export interface GenerationEventRepository {
  append(
    jobId: string,
    type: GenerationEventType,
    payload: Record<string, unknown>,
    now: string,
  ): Promise<GenerationEvent>;
  listForUser(
    userId: string,
    jobId: string,
    afterId: number,
    limit: number,
  ): Promise<GenerationEvent[]>;
}

export class MemoryGenerationEventRepository implements GenerationEventRepository {
  private readonly events = new Map<string, GenerationEvent[]>();
  async append(
    jobId: string,
    type: GenerationEventType,
    payload: Record<string, unknown>,
    now: string,
  ) {
    const list = this.events.get(jobId) || [];
    const event = {
      id: (list.at(-1)?.id || 0) + 1,
      jobId,
      type,
      payload,
      createdAt: now,
    } satisfies GenerationEvent;
    list.push(event);
    this.events.set(jobId, list);
    return event;
  }
  async listForUser(
    _userId: string,
    jobId: string,
    afterId: number,
    limit: number,
  ) {
    return (this.events.get(jobId) || [])
      .filter((event) => event.id > afterId)
      .slice(0, limit);
  }
}
