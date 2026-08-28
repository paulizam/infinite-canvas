import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = { ciphertext: Buffer; iv: Buffer; tag: Buffer };

export class SecretCipher {
  private readonly key: Buffer;
  constructor(encodedKey: string, keyName = "MODEL_SECRET_KEY") {
    this.key = decodeKey(encodedKey);
    if (this.key.length !== 32)
      throw new Error(`${keyName} must decode to exactly 32 bytes`);
  }
  encrypt(plaintext: string, context: string): EncryptedSecret {
    if (!plaintext) throw new Error("Cannot encrypt an empty model credential");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }
  decrypt(secret: EncryptedSecret, context: string) {
    const decipher = createDecipheriv("aes-256-gcm", this.key, secret.iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(secret.tag);
    return Buffer.concat([
      decipher.update(secret.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
function decodeKey(value: string) {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  return Buffer.from(trimmed, "base64");
}
