import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export class PasswordBusy extends Error {}
let active = 0;
const prefix = "scrypt$131072$8$1$";
export const dummyHash = prefix + "00".repeat(16) + "$" + "00".repeat(32);
export function validateNewPassword(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 128 ||
    Buffer.byteLength(value) > 512
  )
    throw new Error(
      "Password must contain 12-128 characters, at most 512 UTF-8 bytes",
    );
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new PasswordBusy();
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        32,
        { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
  } finally {
    active--;
  }
}
export async function hashPassword(password: string): Promise<string> {
  validateNewPassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return prefix + salt.toString("hex") + "$" + key.toString("hex");
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (
    password.length < 1 ||
    password.length > 128 ||
    Buffer.byteLength(password) > 512
  )
    return false;
  const valid = /^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(
    encoded,
  );
  const parts = (valid ? encoded : dummyHash).split("$");
  const key = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(key, Buffer.from(parts[5], "hex")) && valid;
}
