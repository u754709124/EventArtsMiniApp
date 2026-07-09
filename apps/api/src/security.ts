import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const separator = ":";

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return [salt, hash].join(separator);
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(separator);
  if (!salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
