import type { Env, NormalizedEvent, TenantConfig, MetaSecret, Ga4Secret, AdsSecret } from "./types";
import type { SendStatus } from "./d1";

// Resolução de tenant e espelho de eventos via Supabase REST (PostgREST). A service key é
// SECRET do Worker (nunca no bundle/repo). RLS deny-by-default garante que só o service_role
// (este Worker) lê `lp_tracking_secrets` e escreve `lp_events`.

interface SecretRow {
  provider: "meta" | "ga4" | "google_ads";
  public_id: string;
  secret: Record<string, string>;
  test_event_code: string | null;
}

// Cache em memória do isolate (inclui negative cache p/ lp_id sem segredos → evita SELECT/hit).
const TTL_MS = 60_000;
const cache = new Map<string, { config: TenantConfig; exp: number }>();

function headers(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

/** Resolve a config de tracking do tenant (`lp_id`). Retorna listas vazias se não houver
 * segredos cadastrados (também cacheado, como negative cache). */
export async function getTenant(env: Env, lpId: string): Promise<TenantConfig> {
  const hit = cache.get(lpId);
  if (hit && hit.exp > Date.now()) return hit.config;

  const url =
    `${env.SUPABASE_URL}/rest/v1/lp_tracking_secrets` +
    `?landing_page_id=eq.${encodeURIComponent(lpId)}` +
    `&select=provider,public_id,secret,test_event_code`;

  const config: TenantConfig = { meta: [], ga4: [], ads: [] };
  try {
    const r = await fetch(url, { headers: headers(env) });
    if (r.ok) {
      const rows = (await r.json()) as SecretRow[];
      for (const row of rows) {
        if (row.provider === "meta" && row.secret.capi_token) {
          const m: MetaSecret = { public_id: row.public_id, capi_token: row.secret.capi_token };
          if (row.test_event_code) m.test_event_code = row.test_event_code;
          config.meta.push(m);
        } else if (row.provider === "ga4" && row.secret.api_secret) {
          const g: Ga4Secret = { public_id: row.public_id, api_secret: row.secret.api_secret };
          config.ga4.push(g);
        } else if (row.provider === "google_ads") {
          const a: AdsSecret = { public_id: row.public_id, ...row.secret };
          config.ads.push(a);
        }
      }
    }
  } catch {
    // Falha de rede: não cacheia (deixa expirar imediatamente) p/ tentar de novo no próximo hit.
    return config;
  }
  cache.set(lpId, { config, exp: Date.now() + TTL_MS });
  return config;
}

/** Espelha um resumo do evento (SEM PII crua) em `lp_events` para o dashboard nativo.
 * Idempotente por `event_id` (Prefer: resolution=ignore-duplicates). */
export async function mirrorEvent(env: Env, ev: NormalizedEvent, st: SendStatus): Promise<void> {
  const u = ev.utms || {};
  const row = {
    event_id: ev.event_id,
    landing_page_id: ev.lp_id,
    event_name: ev.event_name,
    event_time: new Date(ev.event_time * 1000).toISOString(),
    source_url: ev.event_source_url ?? null,
    utm_source: u.utm_source ?? null,
    utm_medium: u.utm_medium ?? null,
    utm_campaign: u.utm_campaign ?? null,
    utm_content: u.utm_content ?? null,
    utm_term: u.utm_term ?? null,
    country: ev.country ?? null,
    value: (ev.custom.value as number) ?? null,
    currency: (ev.custom.currency as string) ?? null,
    meta_status: st.meta,
    ga_status: st.ga,
    ads_status: st.ads,
    has_email: ev.has_email,
    has_phone: ev.has_phone,
  };
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/lp_events`, {
      method: "POST",
      headers: { ...headers(env), Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
  } catch {
    // Espelho é best-effort: o D1 já tem o evento. Não derruba a resposta ao browser.
  }
}
