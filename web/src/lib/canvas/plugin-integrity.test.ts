import { describe, expect, it } from "vitest";
import { sha256Integrity, verifyPluginIntegrity } from "./plugin-integrity";

describe("plugin integrity", () => {
    it("creates stable SRI", async () => expect(await sha256Integrity("hello")).toBe("sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="));
    it("accepts matching source", async () => expect(verifyPluginIntegrity("hello", await sha256Integrity("hello"))).resolves.toBeUndefined());
    it("rejects changed source", async () => expect(verifyPluginIntegrity("changed", await sha256Integrity("hello"))).rejects.toThrow(/完整性/));
});
