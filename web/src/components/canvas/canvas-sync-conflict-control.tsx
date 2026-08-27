import { App, Button, Modal } from "antd";
import { GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CloudConflictResolution } from "@/services/cloud-canvas-sync";
import { useCloudCanvasSyncStore } from "@/stores/use-cloud-canvas-sync-store";

export function CanvasSyncConflictControl({ projectId }: { projectId: string }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const conflict = useCloudCanvasSyncStore((state) => (state.conflict?.projectId === projectId ? state.conflict : undefined));
    const resolving = useCloudCanvasSyncStore((state) => state.resolving);
    const resolveConflict = useCloudCanvasSyncStore((state) => state.resolveConflict);
    if (!conflict) return null;
    const resolve = async (resolution: CloudConflictResolution) => {
        try {
            await resolveConflict(projectId, resolution);
            if (useCloudCanvasSyncStore.getState().state !== "conflict") {
                setOpen(false);
                message.success(t("collaboration.conflictResolved"));
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("collaboration.conflictFailed"));
        }
    };
    return (
        <>
            <Button danger icon={<GitCompareArrows className="size-4" />} onClick={() => setOpen(true)}>
                {t("collaboration.resolveConflict")}
            </Button>
            <Modal title={t("collaboration.conflictTitle")} open={open} onCancel={() => setOpen(false)} footer={null} centered>
                <p className="mb-4 text-sm text-stone-500">{t("collaboration.conflictDescription", { local: conflict.local.revision, remote: conflict.remote.revision })}</p>
                <div className="grid gap-2">
                    <Button loading={resolving} onClick={() => void resolve("retry_rebase")}>
                        {t("collaboration.retryRebase")}
                    </Button>
                    <Button loading={resolving} onClick={() => void resolve("keep_local_copy")}>
                        {t("collaboration.keepLocalCopy")}
                    </Button>
                    <Button danger loading={resolving} onClick={() => void resolve("accept_remote")}>
                        {t("collaboration.acceptRemote")}
                    </Button>
                </div>
            </Modal>
        </>
    );
}
