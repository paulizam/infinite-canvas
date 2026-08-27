import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretCipher } from "./secret-cipher.js";

describe("model secret cipher", () => {
  it("round-trips AES-GCM ciphertext without containing plaintext", () => {
    const cipher = new SecretCipher(randomBytes(32).toString("base64"));
    const encrypted = cipher.encrypt("provider-secret", "channel-a");
    expect(encrypted.ciphertext.toString()).not.toContain("provider-secret");
    expect(cipher.decrypt(encrypted, "channel-a")).toBe("provider-secret");
    expect(() => cipher.decrypt(encrypted, "channel-b")).toThrow();
  });
  it("rejects incorrectly sized master keys", () => {
    expect(() => new SecretCipher(Buffer.alloc(16).toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});
