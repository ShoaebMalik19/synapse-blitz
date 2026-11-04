import crypto from "node:crypto";
import { env } from "./env";

/** Single-operator prototype auth: a server-issued, HMAC-signed, HttpOnly session cookie. */
export const SESSION_COOKIE = "synapse_session";
const TTL_MS = 12 * 3600_000;

function secret() {
  const s = env().SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (>= 32 chars)");
  return s;
}

export function issueSession(sub = "operator") {
  const exp = Date.now() + TTL_MS;
  const body = `${sub}.${exp}`;
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return { value: `${body}.${sig}`, maxAge: TTL_MS / 1000 };
}

export function verifySession(value: string | undefined | null): { sub: string } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [sub, exp, sig] = parts;
  const expect = crypto.createHmac("sha256", secret()).update(`${sub}.${exp}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return { sub };
}

export function checkAccessToken(token: string) {
  const expected = env().OPERATOR_ACCESS_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
