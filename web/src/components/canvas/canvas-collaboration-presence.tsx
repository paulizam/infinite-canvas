import { Popover } from "antd";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CollaborationPresence } from "@/services/cloud-collaboration";
import { useCollaborationStore } from "@/stores/use-collaboration-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasCollaborationPresenceLayer({ projectId, nodes, zoom }: { projectId: string; nodes: CanvasNodeData[]; zoom: number }) {
    const presence = useCollaborationStore((state) => state.presenceByProject[projectId] || []);
    const ownClientId = useCollaborationStore((state) => state.ownClientIdByProject[projectId]);
    const peers = presence.filter((peer) => peer.clientId !== ownClientId);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const inverseZoom = 1 / Math.max(zoom, 0.05);

    return (
        <div className="pointer-events-none absolute left-0 top-0 z-[80]">
            {peers.flatMap((peer) =>
                peer.selectionIds.flatMap((nodeId) => {
                    const node = nodesById.get(nodeId);
                    if (!node) return [];
                    const color = presenceColor(peer.clientId);
                    return (
                        <div
                            key={`${peer.clientId}:${nodeId}`}
                            className="absolute rounded-lg"
                            style={{ left: node.position.x, top: node.position.y, width: node.width, height: node.height, border: `${2 * inverseZoom}px solid ${color}`, boxShadow: `0 0 0 ${2 * inverseZoom}px ${color}22` }}
                        />
                    );
                }),
            )}
            {peers.map((peer) => (peer.cursor ? <RemoteCursor key={peer.clientId} peer={peer} inverseZoom={inverseZoom} /> : null))}
        </div>
    );
}

export function CanvasCollaborationStatus({ projectId }: { projectId: string }) {
    const { t } = useTranslation();
    const status = useCollaborationStore((state) => state.statusByProject[projectId]);
    const presence = useCollaborationStore((state) => state.presenceByProject[projectId] || []);
    if (!status) return null;
    const connected = status === "connected";
    const content = (
        <div className="min-w-48 space-y-2">
            <p className="text-xs text-stone-500">{t(`collaboration.${status}`)}</p>
            {presence.map((peer) => (
                <div key={peer.clientId} className="flex items-center gap-2 text-sm">
                    <Avatar peer={peer} />
                    <span className="min-w-0 flex-1 truncate">{peer.name}</span>
                    <span className="text-xs text-stone-400">{peer.cursor ? t("collaboration.active") : t("collaboration.online")}</span>
                </div>
            ))}
            {!presence.length ? <p className="text-sm text-stone-400">{t("collaboration.noMembers")}</p> : null}
        </div>
    );
    return (
        <Popover content={content} trigger="click" placement="bottomRight">
            <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium shadow-sm"
                style={{ background: connected ? "rgba(34,197,94,.12)" : "rgba(120,113,108,.12)", color: connected ? "#16a34a" : "#78716c" }}
                aria-label={t("collaboration.members", { count: presence.length })}
            >
                <Users className="size-4" />
                <span>{presence.length}</span>
            </button>
        </Popover>
    );
}

function RemoteCursor({ peer, inverseZoom }: { peer: CollaborationPresence; inverseZoom: number }) {
    const color = presenceColor(peer.clientId);
    return (
        <div className="absolute" style={{ left: peer.cursor!.x, top: peer.cursor!.y, transform: `scale(${inverseZoom})`, transformOrigin: "0 0" }}>
            <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden>
                <path d="M1 1l15 9-7 2-3 7z" fill={color} stroke="white" strokeWidth="1.5" />
            </svg>
            <span className="absolute left-4 top-4 max-w-40 truncate rounded-md px-2 py-1 text-xs font-medium text-white shadow" style={{ background: color }}>
                {peer.name}
            </span>
        </div>
    );
}

function Avatar({ peer }: { peer: CollaborationPresence }) {
    return (
        <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: presenceColor(peer.clientId) }}>
            {peer.name.trim().slice(0, 1).toUpperCase() || "?"}
        </span>
    );
}

function presenceColor(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0;
    return `hsl(${Math.abs(hash) % 360} 68% 48%)`;
}
