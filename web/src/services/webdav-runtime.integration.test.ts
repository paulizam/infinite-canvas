import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
    default: { t: (key: string) => key },
}));
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import { downloadWebdavFile, testWebdavConnection, uploadWebdavFile } from "./webdav-sync";

const endpoint = process.env.WEBDAV_TEST_ENDPOINT?.trim();
const origin = "http://127.0.0.1:3000";
const config: WebdavSyncConfig = {
    url: endpoint || "http://127.0.0.1:19080",
    username: process.env.WEBDAV_TEST_USERNAME || "runtime",
    password: process.env.WEBDAV_TEST_PASSWORD || "runtime-secret",
    directory: `runtime-${Date.now()}`,
    lastSyncedAt: "",
};

describe.runIf(Boolean(endpoint))("WebDAV runtime [AST-007]", () => {
    beforeAll(() => {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                setTimeout: globalThis.setTimeout.bind(globalThis),
                clearTimeout: globalThis.clearTimeout.bind(globalThis),
            },
        });
    });

    it("creates directories and round-trips a binary file with Basic auth", async () => {
        await testWebdavConnection(config);
        const expected = new Uint8Array([0, 1, 2, 127, 255]);
        await uploadWebdavFile(config, "assets/片段.bin", new Blob([expected], { type: "application/octet-stream" }));
        const downloaded = await downloadWebdavFile(config, "assets/片段.bin");
        expect(downloaded).not.toBeNull();
        expect(new Uint8Array(await downloaded!.arrayBuffer())).toEqual(expected);
    });

    it("grants browser CORS preflight for WebDAV methods and auth headers", async () => {
        const response = await fetch(config.url, {
            method: "OPTIONS",
            headers: {
                Origin: origin,
                "Access-Control-Request-Method": "PROPFIND",
                "Access-Control-Request-Headers": "authorization,depth",
            },
        });
        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe(origin);
        expect(response.headers.get("access-control-allow-methods")).toContain("PROPFIND");
        expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    });
});
