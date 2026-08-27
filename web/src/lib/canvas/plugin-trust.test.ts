import { describe, expect, it } from "vitest";
import { assertTrustedPluginUrl, isTrustedPluginUrl } from "./plugin-trust";

const origin = "https://canvas.example";

describe("plugin trust boundary", () => {
    it.each(["/plugins/sticky-note.js", "https://canvas.example/plugins/svg.js?v=1"])("allows bundled same-origin plugin %s", (url) => expect(isTrustedPluginUrl(url, origin)).toBe(true));
    it.each(["https://evil.example/plugin.js", "data:text/javascript,export default{}", "blob:https://canvas.example/id", "/other/plugin.js", "https://user:pass@canvas.example/plugins/a.js"])("blocks untrusted source %s", (url) => expect(isTrustedPluginUrl(url, origin)).toBe(false));
    it("fails closed", () => expect(() => assertTrustedPluginUrl("https://evil.example/a.js", origin)).toThrow(/安全策略/));
});
