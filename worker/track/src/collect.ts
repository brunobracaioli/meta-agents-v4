import type { Env, NormalizedEvent } from "./types";
import {
  parseCookies,
  normEmail,
  normName,
  normPhone,
  hashOrUndef,
  sha256,
  newFbp,
  fbcFromClid,
  fpCookie,
  json,
} from "./lib";
import { sendMetaCapi, sendGa4, sendGoogleAds, type DestResult } from "./destinations";
import { insertEvent, type SendStatus } from "./d1";
import { getTenant, mirrorEvent } from "./supabase";

interface Incoming {
  lp_id?: string;
  event_name?: string;
  event_id?: string;
  event_source_url?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  value?: number;
  currency?: string;
  fbp?: string;
  fbc?: string;
  fbclid?: string;
  gclid?: string;
  ga_client_id?: string;
  utms?: Record<string, string>;
  custom?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Allowlist de eventos que o browser pode enviar (Tampering — STRIDE).
const EVENT_NAMES = new Set([
  "ViewContent",
  "ScrollDepth",
  "AddToCart",
  "InitiateCheckout",
  "Lead",
  "Purchase",
  "CompleteRegistration",
]);
const MAX_BODY = 16_384; // 16KB — corpo de tracking é pequeno; rejeita payload gigante (DoS)
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

const str = (v: unknown, max = 512): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** Status representativo de N chamadas a um destino: 200 se todas OK; senão o 1º não-200; 0 = nenhuma. */
function agg(results: DestResult[]): number {
  if (results.length === 0) return 0;
  const bad = results.find((r) => r.status !== 200);
  return bad ? bad.status : 200;
}

export async function handleCollect(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "payload too large" }, 413, req, env);
  let p: Incoming;
  try {
    p = JSON.parse(raw) as Incoming;
  } catch {
    return json({ error: "invalid json" }, 400, req, env);
  }

  // ---- Validação estrita (Tampering/DoS — STRIDE) ----
  const lpId = str(p.lp_id, 36);
  if (!lpId || !UUID_RE.test(lpId)) return json({ error: "invalid lp_id" }, 400, req, env);
  const eventName = str(p.event_name, 40);
  if (!eventName || !EVENT_NAMES.has(eventName)) return json({ error: "invalid event_name" }, 400, req, env);
  const eventId = str(p.event_id, 64) && UUID_RE.test(p.event_id as string) ? (p.event_id as string) : crypto.randomUUID();

  // ---- Resolve o tenant; sem segredos → no-op silencioso (mas responde ok) ----
  const tenant = await getTenant(env, lpId);

  const cookies = parseCookies(req.headers.get("Cookie"));

  // ---- Identidade first-party (reusa cookie existente -> match estável) ----
  let fbp = cookies["_fbp"] || str(p.fbp, 64);
  const fbcIn = str(p.fbc, 128);
  const fbclid = str(p.fbclid, 256);
  let fbc = cookies["_fbc"] || fbcIn || (fbclid ? fbcFromClid(fbclid) : undefined);
  const setCookies: string[] = [];
  if (!fbp) {
    fbp = newFbp();
    setCookies.push(fpCookie(env, "_fbp", fbp));
  }
  if (fbc && !cookies["_fbc"]) setCookies.push(fpCookie(env, "_fbc", fbc));

  // ---- Sinais de borda (a vantagem server-side que infla o EMQ) ----
  const ip = req.headers.get("CF-Connecting-IP") || undefined;
  const ua = req.headers.get("User-Agent") || undefined;
  const country = (req as unknown as { cf?: { country?: string } }).cf?.country;

  // ---- Hash de PII (nunca persistida crua; Fase 1 normalmente não envia PII) ----
  const emailNorm = normEmail(str(p.email, 320));
  const utms: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = str(p.utms?.[k], 256);
    if (v) utms[k] = v;
  }

  const value = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : undefined;
  const ev: NormalizedEvent = {
    lp_id: lpId,
    event_name: eventName,
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: str(p.event_source_url, 2048) || req.headers.get("Referer") || undefined,
    user: {
      em: await hashOrUndef(emailNorm),
      ph: await hashOrUndef(normPhone(str(p.phone, 40))),
      fn: await hashOrUndef(normName(str(p.first_name, 80))),
      ln: await hashOrUndef(normName(str(p.last_name, 80))),
      external_id: emailNorm ? await sha256(emailNorm) : undefined,
      fbp,
      fbc,
      client_ip_address: ip,
      client_user_agent: ua,
    },
    custom: { value, currency: str(p.currency, 8) || "BRL" },
    gclid: str(p.gclid, 256) || cookies["_gcl_aw"],
    ga_client_id: str(p.ga_client_id, 64),
    utms: Object.keys(utms).length ? utms : undefined,
    has_email: !!emailNorm,
    has_phone: !!normPhone(str(p.phone, 40)),
    country,
  };

  // ---- Fan-out sem segurar a resposta (waitUntil): por pixel/measurement id/ads ----
  ctx.waitUntil(
    (async () => {
      const [metaRes, gaRes, adsRes] = await Promise.all([
        Promise.all(tenant.meta.map((m) => sendMetaCapi(env, m, ev))),
        Promise.all(tenant.ga4.map((g) => sendGa4(g, ev))),
        Promise.all(tenant.ads.map((a) => sendGoogleAds(a, ev))),
      ]);
      const st: SendStatus = {
        meta: agg(metaRes),
        ga: agg(gaRes),
        ads: agg(adsRes),
        pixels: tenant.meta.length,
      };
      await insertEvent(env, ev, st);
      await mirrorEvent(env, ev, st);
    })(),
  );

  const res = json({ ok: true, event_id: ev.event_id }, 200, req, env);
  for (const c of setCookies) res.headers.append("Set-Cookie", c);
  return res;
}
