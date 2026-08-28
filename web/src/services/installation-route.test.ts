import { describe, expect, it, vi } from "vitest";
import { installationRedirect } from "./installation-route";

describe("[BAS-004] installation navigation", () => {
    it("forces only uninstalled Server deployments into the wizard", async () => {
        const uninstalled = { installationStatus: vi.fn(async () => ({ installed: false })) };
        await expect(installationRedirect("/canvas", true, uninstalled as never)).resolves.toBe("/install");
        await expect(installationRedirect("/install", true, uninstalled as never)).resolves.toBeNull();
        const installed = { installationStatus: vi.fn(async () => ({ installed: true })) };
        await expect(installationRedirect("/install", true, installed as never)).resolves.toBe("/account");
    });

    it("keeps Local mode offline and avoids redirect loops on API failure", async () => {
        const client = {
            installationStatus: vi.fn(async () => {
                throw new Error("offline");
            }),
        };
        await expect(installationRedirect("/canvas", false, client as never)).resolves.toBeNull();
        expect(client.installationStatus).not.toHaveBeenCalled();
        await expect(installationRedirect("/canvas", true, client as never)).resolves.toBeNull();
    });
});
