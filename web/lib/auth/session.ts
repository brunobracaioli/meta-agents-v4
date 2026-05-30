/**
 * Session cookie: a short-lived signed JWT (jose, Edge-compatible).
 * The cookie is httpOnly/Secure/SameSite=Lax. We keep no user identity — a
 * valid token simply means "the operator authenticated with the password".
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ultron_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ISSUER = "meta-ads-agency";
const AUDIENCE = "dashboard";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string): Promise<string> {
  return new SignJWT({ role: "operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key(secret));
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return true;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;
