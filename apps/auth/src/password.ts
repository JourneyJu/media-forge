import * as crypto from "node:crypto";

type Argon2Callback = (error: Error | null, tag: Buffer) => void;
type Argon2Parameters = {
  message: Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
};

const argon2Runtime = crypto as typeof crypto & {
  argon2?: (algorithm: "argon2id", parameters: Argon2Parameters, callback: Argon2Callback) => void;
};

const defaultParams = {
  memory: 65536,
  passes: 3,
  parallelism: 1,
  tagLength: 32
};

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

async function argon2id(password: string, salt: Buffer, params = defaultParams): Promise<Buffer> {
  if (!argon2Runtime.argon2) {
    throw new Error("ARGON2_UNAVAILABLE");
  }

  return new Promise((resolve, reject) => {
    argon2Runtime.argon2!("argon2id", {
      message: Buffer.from(password),
      nonce: salt,
      parallelism: params.parallelism,
      tagLength: params.tagLength,
      memory: params.memory,
      passes: params.passes
    }, (error, tag) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(tag);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await argon2id(password, salt);
  const params = `m=${defaultParams.memory},t=${defaultParams.passes},p=${defaultParams.parallelism},l=${defaultParams.tagLength}`;
  return `argon2id$v=1$${params}$${encode(salt)}$${encode(hash)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, version, paramsPart, saltPart, hashPart] = storedHash.split("$");
  if (algorithm !== "argon2id" || version !== "v=1" || !paramsPart || !saltPart || !hashPart) return false;

  const params = Object.fromEntries(paramsPart.split(",").map((item) => {
    const [key, value] = item.split("=");
    return [key, Number(value)];
  }));
  const expected = decode(hashPart);
  const actual = await argon2id(password, decode(saltPart), {
    memory: params.m ?? defaultParams.memory,
    passes: params.t ?? defaultParams.passes,
    parallelism: params.p ?? defaultParams.parallelism,
    tagLength: params.l ?? expected.length
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("base64url");
}
