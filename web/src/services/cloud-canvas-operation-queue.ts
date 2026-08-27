import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasOperation } from "@infinite-canvas/contracts";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type QueuedCanvasCommandBase = { commandId: string; workspaceId: string; projectId: string; createdAt: string };
export type QueuedCanvasMutation = QueuedCanvasCommandBase & { kind: "mutation"; mutationId: string; baseRevision: number; baseDocument: CanvasProject; localDocument: CanvasProject; operations: CanvasOperation[] };
export type QueuedCanvasCreate = QueuedCanvasCommandBase & { kind: "create"; project: CanvasProject };
export type QueuedCanvasDelete = QueuedCanvasCommandBase & { kind: "delete"; baseDocument: CanvasProject };
export type QueuedCanvasCommand = QueuedCanvasMutation | QueuedCanvasCreate | QueuedCanvasDelete;
export interface CanvasOperationQueue {
    list(workspaceId: string): Promise<QueuedCanvasCommand[]>;
    put(entry: QueuedCanvasCommand): Promise<void>;
    remove(workspaceId: string, commandId: string): Promise<void>;
}

export class BrowserCanvasOperationQueue implements CanvasOperationQueue {
    private chains = new Map<string, Promise<unknown>>();
    list(workspaceId: string) {
        return this.enqueue(workspaceId, () => this.read(workspaceId));
    }
    put(entry: QueuedCanvasCommand) {
        return this.enqueue(entry.workspaceId, async () => {
            const entries = await this.read(entry.workspaceId);
            await localForageStorage.setItem(key(entry.workspaceId), JSON.stringify([...entries.filter((item) => item.commandId !== entry.commandId), entry]));
        });
    }
    remove(workspaceId: string, commandId: string) {
        return this.enqueue(workspaceId, async () => {
            const entries = (await this.read(workspaceId)).filter((item) => item.commandId !== commandId);
            if (entries.length) await localForageStorage.setItem(key(workspaceId), JSON.stringify(entries));
            else await localForageStorage.removeItem(key(workspaceId));
        });
    }
    private async read(workspaceId: string): Promise<QueuedCanvasCommand[]> {
        const raw = await localForageStorage.getItem(key(workspaceId));
        if (!raw) return [];
        try {
            const entries = JSON.parse(raw) as Array<QueuedCanvasCommand | (Omit<QueuedCanvasMutation, "kind" | "commandId"> & { kind?: undefined; commandId?: undefined })>;
            if (!Array.isArray(entries)) return [];
            return entries.flatMap((entry) => {
                if (entry?.workspaceId !== workspaceId) return [];
                if (!entry.kind && "mutationId" in entry && typeof entry.mutationId === "string") return [{ ...entry, kind: "mutation" as const, commandId: entry.mutationId } as QueuedCanvasMutation];
                return "commandId" in entry && typeof entry.commandId === "string" && ["mutation", "create", "delete"].includes(entry.kind) ? [entry as QueuedCanvasCommand] : [];
            });
        } catch {
            return [];
        }
    }
    private enqueue<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.chains.get(workspaceId) || Promise.resolve();
        const lockedTask = () => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(`infinite-canvas:queue:${workspaceId}`, task) : task());
        const current = previous.then(lockedTask, lockedTask);
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
