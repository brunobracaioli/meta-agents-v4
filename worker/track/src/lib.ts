import type { Env } from "./types";

// ---------- Hashing (Meta Advanced Matching exige SHA-256 do dado normalizado) ----------
export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function hashOrUndef(v?: string): Promise<string | undefined> {
  return v ? sha256(v) : undefined;
}

// ---------- Normalização exigida pelo Meta antes do hash ----------
export const normEmail = (v?: string) => (v ? v.trim().toLowerCase() : undefined);
export const normName = (v?: string) => (v ? v.trim().toLowerCase().replace(/\s+/g, "") : undefined);
export function normPhone(v?: string): string | undefined {
  if (!v) return undefined;
  const digits = v.replace(/\D/g, ""); // E.164 sem '+', conforme Meta
  return digits || undefined;
}

// ---------- Cookies ----------
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// NÃO usamos HttpOnly de propósito: o Pixel (fbevents.js) precisa ler _fbp/_fbc no client.
// O ganho é que o Set-Cookie vem do SERVIDOR first-party. Domain=.b2tech.io porque o Worker
// é same-site de todas as LPs (*.b2tech.io) → cookie first-party que sobrevive ao ITP.
export function fpCookie(env: Env, name: string, value: string, days = 90): string {
  const domain = env.ALLOWED_ORIGIN_SUFFIX.replace(/^\.?/, "."); // ".b2tech.io"
  return `${name}=${value}; Domain=${domain}; Path=/; Max-Age=${days * 86400}; SameSite=Lax; Secure`;
}

// ---------- IDs Meta ----------
export const newFbp = () => `fb.1.${Date.now()}.${Math.floor(Math.random() * 1e16)}`;
export const fbcFromClid = (fbclid: string) => `fb.1.${Date.now()}.${fbclid}`;

// ---------- CORS (allowlist por SUFIXO de host — same-site *.b2tech.io) ----------
export function originAllowed(origin: string, env: Env): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    const suffix = env.ALLOWED_ORIGIN_SUFFIX.replace(/^\.?/, ".");
    // host === "b2tech.io" OU host termina em ".b2tech.io"
    return host === suffix.slice(1) || host.endsWith(suffix);
  } catch {
    return false;
  }
}
export function cors(req: Request, env: Env, res: Response): Response {
  const origin = req.headers.get("Origin") || "";
  const ok = originAllowed(origin, env);
  const h = new Headers(res.headers);
  if (ok) h.set("Access-Control-Allow-Origin", origin);
  h.append("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  h.set("Access-Control-Allow-Credentials", "true");
  return new Response(res.body, { status: res.status, headers: h });
}

export function json(data: unknown, status: number, req: Request, env: Env): Response {
  return cors(
    req,
    env,
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }),
  );
}

// ---------- Rate-limit por IP (best-effort, em memória do isolate) ----------
// Token bucket simples por isolate. NÃO é global (cada colo tem seus isolates) — é uma
// primeira barreira barata contra flood. Escalada (Turnstile/WAF) está no threat model.
const buckets = new Map<string, { tokens: number; ts: number }>();
export function rateLimited(ip: string, ratePerMin = 120, burst = 60): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: burst, ts: now };
  const refill = ((now - b.ts) / 60000) * ratePerMin;
  b.tokens = Math.min(burst, b.tokens + refill);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return true;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return false;
}
