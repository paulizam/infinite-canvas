import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Input, Select, Switch } from "antd";
import { Download, FileUp, Plus, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { parseCanvasExportFile, validateCanvasImportAssets } from "@/lib/canvas/canvas-import";
import { organizeCanvasProjects } from "@/lib/canvas/canvas-project-organization";
import { CANVAS_PROJECT_TEMPLATES, type CanvasProjectTemplateId } from "@/lib/canvas/canvas-project-templates";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const markProjectOpened = useCanvasStore((state) => state.markProjectOpened);
    const [query, setQuery] = useState("");
    const [folderId, setFolderId] = useState("all");
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const folders = useMemo(() => [...new Set(projects.map((project) => project.folderId).filter((value): value is string => Boolean(value)))].sort(), [projects]);
    const visibleProjects = useMemo(() => organizeCanvasProjects(projects, { query, folderId: folderId === "all" ? undefined : folderId === "root" ? null : folderId, favoritesOnly }), [favoritesOnly, folderId, projects, query]);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        markProjectOpened(id);
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = () => enterProject(createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    const createFromTemplate = (templateId: CanvasProjectTemplateId) => enterProject(createProject(t("canvas.defaultTitle", { count: projects.length + 1 }), templateId));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data: CanvasExportFile = parseCanvasExportFile(JSON.parse(await projectFile.text()));
            await Promise.all(validateCanvasImportAssets(data, zip).map(({ file: item, blob }) => (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, blob) : setMediaBlob(item.storageKey, blob))));
            data.projects.forEach((item) => importProject(item.project));
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 })) : projects[0]?.id || createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{t("canvas.library")}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{t("canvas.title")}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button
                                    disabled={!hydrated}
                                    icon={<Download className="size-4" />}
                                    onClick={() =>
                                        void exportCanvasProjects(
                                            projects.filter((project) => selectedIds.includes(project.id)),
                                            `${t("canvas.title")}-${selectedIds.length}`,
                                        )
                                    }
                                >
                                    {t("canvas.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    {t("canvas.deleteSelected")}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.deleteAll")}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.import")}
                        </Button>
                        <Dropdown menu={{ items: CANVAS_PROJECT_TEMPLATES.map((template) => ({ key: template.id, label: t(template.titleKey) })), onClick: ({ key }) => createFromTemplate(key as CanvasProjectTemplateId) }}>
                            <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />}>
                                {t("canvas.create")}
                            </Button>
                        </Dropdown>
                    </div>
                </header>

                {hydrated && projects.length ? (
                    <section className="flex flex-wrap items-center gap-3">
                        <Input.Search allowClear className="min-w-56 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("canvas.project.search")} />
                        <Select
                            className="w-44"
                            value={folderId}
                            onChange={setFolderId}
                            options={[{ value: "all", label: t("canvas.project.allFolders") }, { value: "root", label: t("canvas.project.rootFolder") }, ...folders.map((folder) => ({ value: folder, label: folder }))]}
                        />
                        <span className="flex items-center gap-2 text-sm">
                            <Star className="size-4" />
                            <Switch size="small" checked={favoritesOnly} onChange={setFavoritesOnly} />
                            {t("canvas.project.favorites")}
                        </span>
                    </section>
                ) : null}

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{t("canvas.loading")}</section>
                ) : visibleProjects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {visibleProjects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-stone-500">{t("canvas.emptyDescription")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
