export function isTrustedPluginUrl(value: string, appOrigin: string): boolean {
    try {
        const url = new URL(value, appOrigin);
        const origin = new URL(appOrigin).origin;
        return url.origin === origin && !url.username && !url.password && url.pathname.startsWith("/plugins/") && url.pathname.endsWith(".js");
    } catch {
        return false;
    }
}

export function assertTrustedPluginUrl(value: string, appOrigin: string): void {
    if (!isTrustedPluginUrl(value, appOrigin)) throw new Error("远程插件已被安全策略阻止；仅允许应用内置的同源 /plugins/*.js 插件");
}
