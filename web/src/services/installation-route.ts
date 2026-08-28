import type { CloudPlatformClient } from "./cloud-platform";

export async function installationRedirect(pathname: string, serverMode: boolean, client: Pick<CloudPlatformClient, "installationStatus">) {
    if (!serverMode) return pathname === "/install" ? "/account" : null;
    try {
        const { installed } = await client.installationStatus();
        if (!installed && pathname !== "/install") return "/install";
        if (installed && pathname === "/install") return "/account";
    } catch {
        // Availability errors belong to the regular application error boundary;
        // never turn them into a redirect loop.
    }
    return null;
}
