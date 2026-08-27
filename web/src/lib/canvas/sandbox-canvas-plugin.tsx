import type { PluginPermission } from "@infinite-canvas/contracts";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import type { SandboxPluginDescriptor } from "@/lib/canvas/plugin-sandbox";

export function createSandboxCanvasPlugin(descriptor: SandboxPluginDescriptor, permissions: PluginPermission[]): CanvasPlugin {
    const canWrite = permissions.includes("canvas:write");
    return {
        ...descriptor,
        nodes: descriptor.nodes.map((node) => ({
            ...node,
            icon: null,
            Content: ({ ctx }) => {
                const content = typeof ctx.node.metadata?.content === "string" ? ctx.node.metadata.content : "";
                return <textarea className="h-full w-full resize-none bg-transparent p-3 outline-none" value={content} readOnly={!canWrite} onChange={(event) => ctx.updateMetadata({ content: event.target.value })} />;
            },
        })),
    };
}
