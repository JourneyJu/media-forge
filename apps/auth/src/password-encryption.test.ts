import { publicEncrypt, constants } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPasswordDecryptor, decryptPassword, passwordEncryptionKey } from "./password-encryption";

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

describe("password encryption", () => {
  it("decrypts RSA-OAEP encrypted password envelopes", () => {
    const decryptor = createPasswordDecryptor();
    const publicKey = passwordEncryptionKey(decryptor);
    const ciphertext = publicEncrypt({
      key: decryptor.publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    }, Buffer.from("local-password-123"));

    expect(decryptPassword({
      alg: "RSA-OAEP-256",
      kid: publicKey.kid,
      ciphertext: base64url(ciphertext)
    }, decryptor)).toBe("local-password-123");
  });
});
