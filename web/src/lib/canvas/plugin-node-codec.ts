import { getNodeDefinition, getNodePluginId } from "@/lib/canvas/node-registry";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

const MAX_PLUGIN_STATE_BYTES = 1024 * 1024;

export function serializePluginNode(node: CanvasNodeData): CanvasNodeData {
    const definition = getNodeDefinition(node.type);
    const codec = definition?.serialization;
    const pluginId = getNodePluginId(node.type);
    if (!codec || pluginId === "builtin") return node;
    assertSchemaVersion(codec.schemaVersion);
    const decoded = deserializePluginNode(node);
    const liveMetadata = { ...node.metadata };
    delete liveMetadata.__pluginState;
    delete liveMetadata.pluginCodecError;
    const materialized = { ...decoded, metadata: { ...decoded.metadata, ...liveMetadata } };
    const data = assertJsonState(codec.serialize(materialized));
    return { ...materialized, metadata: { ...materialized.metadata, __pluginState: { pluginId, nodeType: node.type, schemaVersion: codec.schemaVersion, data }, pluginCodecError: undefined } };
}

export function deserializePluginNode(node: CanvasNodeData): CanvasNodeData {
    const envelope = node.metadata?.__pluginState;
    if (!envelope) return node;
    const definition = getNodeDefinition(node.type);
    const codec = definition?.serialization;
    const pluginId = getNodePluginId(node.type);
    if (!codec || pluginId === "builtin") return node;
    if (envelope.pluginId !== pluginId || envelope.nodeType !== node.type) return withError(node, "插件序列化标识不匹配");
    try {
        assertSchemaVersion(codec.schemaVersion);
        if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) throw new Error("插件 schemaVersion 无效");
        if (envelope.schemaVersion > codec.schemaVersion) throw new Error(`插件数据版本 ${envelope.schemaVersion} 高于当前支持版本 ${codec.schemaVersion}`);
        let data = assertJsonState(envelope.data);
        if (envelope.schemaVersion < codec.schemaVersion) {
            if (!codec.migrate) throw new Error(`插件缺少 ${envelope.schemaVersion} → ${codec.schemaVersion} migration`);
            data = assertJsonState(codec.migrate(data, envelope.schemaVersion, codec.schemaVersion));
        }
        const decoded = codec.deserialize(data, node);
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("插件 deserialize 必须返回 metadata 对象");
        const metadata: CanvasNodeMetadata = { ...node.metadata, ...decoded, __pluginState: { ...envelope, schemaVersion: codec.schemaVersion, data }, pluginCodecError: undefined };
        return { ...node, metadata };
    } catch (error) {
        return withError(node, error instanceof Error ? error.message : String(error));
    }
}

function assertJsonState(value: unknown) {
    let json: string;
    try {
        json = JSON.stringify(value);
    } catch {
        throw new Error("插件序列化数据必须是无循环 JSON");
    }
    if (json === undefined) throw new Error("插件序列化数据不能是 undefined");
    if (new TextEncoder().encode(json).byteLength > MAX_PLUGIN_STATE_BYTES) throw new Error("插件序列化数据超过 1MiB 限额");
    return JSON.parse(json) as unknown;
}

function assertSchemaVersion(value: number) {
    if (!Number.isInteger(value) || value < 1) throw new Error("插件 schemaVersion 必须是正整数");
}

function withError(node: CanvasNodeData, message: string): CanvasNodeData {
    return { ...node, metadata: { ...node.metadata, pluginCodecError: message } };
}
