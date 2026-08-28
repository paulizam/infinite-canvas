import { Component, type ErrorInfo, type ReactNode } from "react";
import { usePluginStore } from "@/stores/canvas/use-plugin-store";

type Props = { pluginId: string; surface: "content" | "panel"; resetKey: string; children: ReactNode };
type State = { error?: string };

export class PluginErrorBoundary extends Component<Props, State> {
    state: State = {};

    static getDerivedStateFromError(error: unknown): State {
        return { error: error instanceof Error ? error.message : String(error) };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        const message = `${this.props.surface}: ${error instanceof Error ? error.message : String(error)}`;
        usePluginStore.getState().setDiagnostic(this.props.pluginId, message);
        console.error(`[plugin] ${this.props.pluginId} ${message}`, info.componentStack);
    }

    componentDidUpdate(previous: Props) {
        if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: undefined });
    }

    render() {
        if (this.state.error)
            return (
                <div role="alert" className="grid h-full min-h-20 place-items-center p-3 text-center text-xs text-red-500">
                    插件{this.props.surface === "panel" ? "面板" : "节点"}运行失败：{this.state.error}
                </div>
            );
        return this.props.children;
    }
}
