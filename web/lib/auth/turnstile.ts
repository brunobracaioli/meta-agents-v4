/**
 * Server-side verification of a Cloudflare Turnstile token via the siteverify API.
 *
 * The browser solves the Turnstile challenge and sends the resulting token with the
 * login request; we exchange it for a pass/fail here using the SECRET key. Tokens are
 * single-use and short-lived, so each login attempt needs a fresh one. Fails closed:
 * any network/parse error or a non-success response is treated as "not a human".
 */
import "server-only";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  // remoteip is optional; "unknown" is our sentinel when no client IP is resolvable.
  if (remoteIp && remoteIp !== "unknown") {
    form.set("remoteip", remoteIp);
  }

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as SiteverifyResponse;
    return data.success === true;
  } catch {
    return false;
  }
}
