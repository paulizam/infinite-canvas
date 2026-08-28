import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented } from "antd";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize } from "@/lib/canvas/canvas-image-data";

export type CanvasImageSuperResolutionParams = {
    targetLongEdge: number;
    detail: "faithful" | "enhanced";
};

const targets = [2048, MAX_UPSCALE_LONG_EDGE];

export function CanvasNodeSuperResolutionDialog({ dataUrl, model, open, onClose, onConfirm }: { dataUrl: string; model: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageSuperResolutionParams) => void }) {
    const { t } = useTranslation();
    const [params, setParams] = useState<CanvasImageSuperResolutionParams>({ targetLongEdge: 2048, detail: "faithful" });
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const output = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge) : null), [image, params.targetLongEdge]);
    const canSubmit = Boolean(image && sourceLongEdge < params.targetLongEdge);

    useEffect(() => {
        if (!open) return;
        setImage(null);
        setParams({ targetLongEdge: 2048, detail: "faithful" });
        void readImageMeta(dataUrl).then((metadata) => {
            setImage(metadata);
            setParams((current) => ({ ...current, targetLongEdge: targets.find((target) => Math.max(metadata.width, metadata.height) < target) || MAX_UPSCALE_LONG_EDGE }));
        });
    }, [dataUrl, open]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={820} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.superResolution.title")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.superResolution.description")}</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
                            <img src={dataUrl} alt="" className="max-h-[320px] max-w-full rounded-lg object-contain shadow-xl" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">{t("canvas.editors.source")}</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : t("canvas.editors.loading")}</span>
                        </div>
                    </div>
                    <div className="space-y-5 py-2">
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.superResolution.model")}</div>
                            <div className="rounded-lg border px-3 py-2 text-sm">{model || t("canvas.superResolution.defaultModel")}</div>
                        </div>
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.editors.targetPixels")}</div>
                            <Segmented
                                block
                                value={params.targetLongEdge}
                                options={targets.map((target) => ({ label: `${target / 1024}K · ${target}px`, value: target, disabled: sourceLongEdge >= target }))}
                                onChange={(value) => setParams((current) => ({ ...current, targetLongEdge: Number(value) }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.superResolution.detail")}</div>
                            <Segmented
                                block
                                value={params.detail}
                                options={(["faithful", "enhanced"] as const).map((detail) => ({ value: detail, label: t(`canvas.superResolution.${detail}`) }))}
                                onChange={(value) => setParams((current) => ({ ...current, detail: value as CanvasImageSuperResolutionParams["detail"] }))}
                            />
                        </div>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">{t("canvas.editors.outputSize")}</span>
                                <span className="font-semibold">{output ? `${output.width} x ${output.height} px` : t("canvas.editors.unknown")}</span>
                            </div>
                        </div>
                        {!canSubmit && image ? <div className="text-xs font-medium text-[#ef4444]">{t("canvas.editors.maxReached")}</div> : null}
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<Sparkles className="size-4" />} disabled={!canSubmit} onClick={() => onConfirm(params)}>
                        {t("canvas.superResolution.submit")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
