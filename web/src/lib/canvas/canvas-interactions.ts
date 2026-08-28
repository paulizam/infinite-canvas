import type { CanvasConnection, CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

export type CanvasClipboardData = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };

export function zoomViewportAround(viewport: ViewportTransform, viewportSize: { width: number; height: number }, scale: number): ViewportTransform {
    const nextScale = Math.min(Math.max(Number.isFinite(scale) ? scale : viewport.k, 0.05), 5);
    const currentScale = Number.isFinite(viewport.k) && viewport.k > 0 ? viewport.k : 1;
    return {
        x: viewportSize.width / 2 - ((viewportSize.width / 2 - viewport.x) / currentScale) * nextScale,
        y: viewportSize.height / 2 - ((viewportSize.height / 2 - viewport.y) / currentScale) * nextScale,
        k: nextScale,
    };
}

export function selectNodesInRect(nodes: readonly CanvasNodeData[], start: Position, end: Position, initialIds: Iterable<string> = []) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);
    const selected = new Set(initialIds);
    nodes.forEach((node) => {
        if (left < node.position.x + node.width && right > node.position.x && top < node.position.y + node.height && bottom > node.position.y) selected.add(node.id);
    });
    return selected;
}

export function buildPastedCanvas(clipboard: CanvasClipboardData, center: Position, createId: (kind: "node" | "connection", index: number, sourceId: string) => string): CanvasClipboardData {
    if (!clipboard.nodes.length) return { nodes: [], connections: [] };
    const bounds = clipboard.nodes.reduce((acc, node) => ({ left: Math.min(acc.left, node.position.x), top: Math.min(acc.top, node.position.y), right: Math.max(acc.right, node.position.x + node.width), bottom: Math.max(acc.bottom, node.position.y + node.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const dx = center.x - (bounds.left + bounds.right) / 2;
    const dy = center.y - (bounds.top + bounds.bottom) / 2;
    const idMap = new Map<string, string>();
    const copied = clipboard.nodes.map((node, index) => {
        const id = createId("node", index, node.id);
        idMap.set(node.id, id);
        return { ...node, id, title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: node.metadata ? { ...node.metadata } : undefined };
    });
    const nodes = copied.map((node) => node.metadata?.groupId ? { ...node, metadata: { ...node.metadata, groupId: idMap.get(node.metadata.groupId) } } : node);
    const connections = clipboard.connections.flatMap((connection, index) => {
        const fromNodeId = idMap.get(connection.fromNodeId);
        const toNodeId = idMap.get(connection.toNodeId);
        return fromNodeId && toNodeId ? [{ ...connection, id: createId("connection", index, connection.id), fromNodeId, toNodeId }] : [];
    });
    return { nodes, connections };
}
