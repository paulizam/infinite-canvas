import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasOperation } from "@infinite-canvas/contracts";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type QueuedCanvasMutation = { mutationId: string; workspaceId: string; projectId: string; baseRevision: number; baseDocument: CanvasProject; localDocument: CanvasProject; operations: CanvasOperation[]; createdAt: string };
export interface CanvasOperationQueue {
    list(workspaceId: string): Promise<QueuedCanvasMutation[]>;
    put(entry: QueuedCanvasMutation): Promise<void>;
    remove(workspaceId: string, mutationId: string): Promise<void>;
}

export class BrowserCanvasOperationQueue implements CanvasOperationQueue {
    private chains = new Map<string, Promise<unknown>>();
    list(workspaceId: string) {
        return this.enqueue(workspaceId, () => this.read(workspaceId));
    }
    put(entry: QueuedCanvasMutation) {
        return this.enqueue(entry.workspaceId, async () => {
            const entries = await this.read(entry.workspaceId);
            await localForageStorage.setItem(key(entry.workspaceId), JSON.stringify([...entries.filter((item) => item.mutationId !== entry.mutationId), entry]));
        });
    }
    remove(workspaceId: string, mutationId: string) {
        return this.enqueue(workspaceId, async () => {
            const entries = (await this.read(workspaceId)).filter((item) => item.mutationId !== mutationId);
            if (entries.length) await localForageStorage.setItem(key(workspaceId), JSON.stringify(entries));
            else await localForageStorage.removeItem(key(workspaceId));
        });
    }
    private async read(workspaceId: string): Promise<QueuedCanvasMutation[]> {
        const raw = await localForageStorage.getItem(key(workspaceId));
        if (!raw) return [];
        try {
            const entries = JSON.parse(raw) as QueuedCanvasMutation[];
            return Array.isArray(entries) ? entries.filter((entry) => entry?.workspaceId === workspaceId && typeof entry.mutationId === "string") : [];
        } catch {
            return [];
        }
    }
    private enqueue<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.chains.get(workspaceId) || Promise.resolve();
        const current = previous.then(task, task);
        this.chains.set(workspaceId, current);
        return current.finally(() => {
            if (this.chains.get(workspaceId) === current) this.chains.delete(workspaceId);
        });
    }
}
function key(workspaceId: string) {
    return `infinite-canvas:cloud-operation-queue:${workspaceId}`;
}
export const browserCanvasOperationQueue = new BrowserCanvasOperationQueue();
