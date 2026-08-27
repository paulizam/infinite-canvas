import { describe, expect, it } from "vitest";
import { networkOriginsFromPermissions } from "./plugin-sandbox";

describe("sandbox permissions", () => {
    it("extracts explicit HTTPS origins", () => expect(networkOriginsFromPermissions(["canvas:read", "network:https://api.example"])).toEqual(["https://api.example"]));
    it.each(["network:http://api.example", "network:https://api.example/path", "unknown"])("rejects unsafe permission %s", (permission) => expect(() => networkOriginsFromPermissions([permission as never])).toThrow());
});
