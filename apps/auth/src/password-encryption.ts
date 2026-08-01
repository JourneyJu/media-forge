import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  type KeyObject
} from "node:crypto";
import type { EncryptedPassword, PasswordEncryptionKeyResponse } from "@mediaforge/contracts";

export type PasswordDecryptor = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

export function createPasswordDecryptor(): PasswordDecryptor {
  const pem = process.env.AUTH_PASSWORD_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  const privateKey = pem
    ? createPrivateKey(pem)
    : generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ type: "spki", format: "der" });
  const kid = createHash("sha256").update(der).digest("base64url").slice(0, 16);
  return { kid, privateKey, publicKey };
}

export function passwordEncryptionKey(decryptor: PasswordDecryptor): PasswordEncryptionKeyResponse {
  const jwk = decryptor.publicKey.export({ format: "jwk" });
  if (!jwk.n || !jwk.e) throw new Error("PASSWORD_KEY_EXPORT_FAILED");
  return {
    kid: decryptor.kid,
    alg: "RSA-OAEP-256",
    publicKey: {
      kty: "RSA",
      n: jwk.n,
      e: jwk.e,
      kid: decryptor.kid,
      alg: "RSA-OAEP-256",
      key_ops: ["encrypt"],
      ext: true
    }
  };
}

export function decryptPassword(encrypted: EncryptedPassword, decryptor: PasswordDecryptor): string {
  if (encrypted.alg !== "RSA-OAEP-256" || encrypted.kid !== decryptor.kid) {
    throw new Error("AUTH_PASSWORD_KEY_INVALID");
  }
  const decrypted = privateDecrypt({
    key: decryptor.privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  }, Buffer.from(encrypted.ciphertext, "base64url")).toString("utf8");
  if (!decrypted || decrypted.length > 256) throw new Error("VALIDATION_ERROR");
  return decrypted;
}
