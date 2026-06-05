// Tipagem central do tagging server MULTI-TENANT (Fase 2 — ADR 0021).
// Diferente da referência single-tenant (track_feature/), aqui os segredos NÃO vêm do
// Env: cada landing page tem seus próprios pixels/tokens, resolvidos por `lp_id` a partir
// de `lp_tracking_secrets` no Supabase (ver supabase.ts). O Env só carrega infra/credencial
// de plataforma — toda via `wrangler secret put`, nunca hardcoded.

export interface Env {
  // D1 (banco de eventos na borda)
  DB: D1Database;

  // Supabase (resolve segredos por tenant + espelha eventos). SERVICE_KEY é SECRET do Worker.
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // CORS: aceita Origins cujo host termina neste sufixo (ex.: ".b2tech.io"). Same-site.
  ALLOWED_ORIGIN_SUFFIX: string;

  // Operacional (vars / secrets opcionais)
  META_API_VERSION?: string; // default "v21.0"
  META_TEST_EVENT_CODE?: string; // homologação (Test Events) — global, opcional
  DASHBOARD_TOKEN?: string; // protege o /dash de borda (fallback do dashboard nativo)
}

// ---- Config resolvida do tenant (a partir de lp_tracking_secrets) ----
export interface MetaSecret {
  public_id: string; // pixel id
  capi_token: string;
  test_event_code?: string;
}
export interface Ga4Secret {
  public_id: string; // measurement id (G-…)
  api_secret: string;
}
export interface AdsSecret {
  public_id: string; // customer id
  developer_token?: string;
  conversion_action?: string;
  login_customer_id?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
}
export interface TenantConfig {
  meta: MetaSecret[];
  ga4: Ga4Secret[];
  ads: AdsSecret[];
}

export interface UserData {
  // Hasheados (SHA-256) quando aplicável — exceto fbp/fbc/ip/ua.
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  external_id?: string;
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

export interface Utms {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export interface NormalizedEvent {
  lp_id: string; // tenant — resolve os segredos
  event_name: string; // "Lead", "InitiateCheckout"...
  event_id: string; // CHAVE DE DEDUP com o Pixel do browser
  event_time: number; // unix seconds
  event_source_url?: string;
  user: UserData;
  custom: Record<string, unknown>;
  gclid?: string;
  ga_client_id?: string;
  utms?: Utms;
  has_email: boolean;
  has_phone: boolean;
  country?: string;
}
