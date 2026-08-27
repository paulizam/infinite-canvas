export async function sha256Integrity(source: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const bytes = new Uint8Array(digest);
    let binary = "";
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
    return `sha256-${btoa(binary)}`;
}

export async function verifyPluginIntegrity(source: string, expected: string): Promise<void> {
    if (!expected.startsWith("sha256-") || (await sha256Integrity(source)) !== expected) throw new Error("插件完整性校验失败");
}
