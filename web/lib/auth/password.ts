/**
 * Verifies the operator password against DASHBOARD_PASSWORD.
 *
 * DASHBOARD_PASSWORD is stored as a SHA-256 hex digest (64 hex chars). If a
 * non-hash value is ever configured, we fall back to a constant-time plaintext
 * compare so misconfiguration fails closed rather than silently allowing access.
 * Uses Web Crypto so it runs in both Node and Edge runtimes.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/i;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPassword(
  input: string,
  expected: string,
): Promise<boolean> {
  if (!input) return false;
  if (SHA256_HEX.test(expected)) {
    const hashed = await sha256Hex(input);
    return timingSafeEqual(hashed.toLowerCase(), expected.toLowerCase());
  }
  return timingSafeEqual(input, expected);
}
