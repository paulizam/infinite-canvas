import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
    default: { t: (key: string) => key },
}));

import type { WebdavSyncConfig } from "@/stores/use-config-store";
import { downloadWebdavFile, testWebdavConnection, uploadWebdavFile } from "./webdav-sync";

const config = (directory: string): WebdavSyncConfig => ({
    url: "https://dav.example/root/",
    username: "创作者",
    password: "p@ss",
    directory,
    lastSyncedAt: "",
});

describe("WebDAV sync contract", () => {
    beforeEach(() => {
        vi.stubGlobal("window", {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("creates nested directories, encodes paths, and authenticates every request", async () => {
        const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(null, { status: init?.method === "PROPFIND" ? 207 : 201 }));
        vi.stubGlobal("fetch", fetcher);

        await testWebdavConnection(config("team space/canvas"));

        expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
            ["https://dav.example/root/team%20space", "MKCOL"],
            ["https://dav.example/root/team%20space/canvas", "MKCOL"],
            ["https://dav.example/root/team%20space/canvas", "PROPFIND"],
        ]);
        for (const [, init] of fetcher.mock.calls) {
            const header = new Headers(init?.headers).get("Authorization");
            expect(header).toMatch(/^Basic /);
            const binary = atob(header!.slice(6));
            expect(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))).toBe("创作者:p@ss");
        }
    });

    it("creates media subdirectories and uploads the original content type [AST-007]", async () => {
        const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 201 }));
        vi.stubGlobal("fetch", fetcher);
        const file = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });

        await uploadWebdavFile(config("sync-upload"), "/assets/video/片段 1.mp4/", file, "video/mp4");

        expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
            ["https://dav.example/root/sync-upload", "MKCOL"],
            ["https://dav.example/root/sync-upload/assets", "MKCOL"],
            ["https://dav.example/root/sync-upload/assets/video", "MKCOL"],
            ["https://dav.example/root/sync-upload/assets/video/%E7%89%87%E6%AE%B5%201.mp4", "PUT"],
        ]);
        const put = fetcher.mock.calls.at(-1)?.[1];
        expect(new Headers(put?.headers).get("Content-Type")).toBe("video/mp4");
        expect(put?.body).toBe(file);
    });

    it("treats a missing remote file as an empty sync state", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 201 }))
            .mockResolvedValueOnce(new Response(null, { status: 404 }));
        vi.stubGlobal("fetch", fetcher);

        await expect(downloadWebdavFile(config("sync-missing"), "assets/manifest.json")).resolves.toBeNull();
    });

    it("maps authentication and transport failures without leaking response bodies", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(new Response(null, { status: 201 }))
                .mockResolvedValueOnce(new Response("private upstream detail", { status: 401 })),
        );
        await expect(downloadWebdavFile(config("sync-auth"), "manifest.json")).rejects.toThrow(/authenticationFailed/);

        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("socket exposed");
            }),
        );
        await expect(testWebdavConnection(config("sync-network"))).rejects.toThrow(/connectionFailed/);
    });
});
