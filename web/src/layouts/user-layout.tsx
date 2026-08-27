import { useEffect, useRef, type ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { CloudCanvasBridge } from "@/components/layout/cloud-canvas-bridge";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const initialized = useRef(false);
    const initializeSession = useCloudSessionStore((state) => state.initialize);
    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        void initializeSession();
    }, [initializeSession]);
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <CloudCanvasBridge />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
