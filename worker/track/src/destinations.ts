import type { Env, NormalizedEvent, MetaSecret, Ga4Secret, AdsSecret } from "./types";

export interface DestResult {
  status: number;
  body: string;
}

// ============================================================
// META — Conversions API (por pixel; MESMO event_id do Pixel do browser → dedup)
// ============================================================
export async function sendMetaCapi(env: Env, pixel: MetaSecret, ev: NormalizedEvent): Promise<DestResult> {
  const version = env.META_API_VERSION || "v21.0";
  const url = `https://graph.facebook.com/${version}/${pixel.public_id}/events?access_token=${pixel.capi_token}`;

  const ud: Record<string, unknown> = {
    fbp: ev.user.fbp,
    fbc: ev.user.fbc,
    client_ip_address: ev.user.client_ip_address, // IP real capturado na borda
    client_user_agent: ev.user.client_user_agent,
  };
  if (ev.user.em) ud.em = [ev.user.em];
  if (ev.user.ph) ud.ph = [ev.user.ph];
  if (ev.user.fn) ud.fn = [ev.user.fn];
  if (ev.user.ln) ud.ln = [ev.user.ln];
  if (ev.user.external_id) ud.external_id = [ev.user.external_id];

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: ev.event_name,
        event_time: ev.event_time,
        event_id: ev.event_id,
        action_source: "website",
        event_source_url: ev.event_source_url,
        user_data: ud,
        custom_data: ev.custom,
      },
    ],
  };
  const testCode = pixel.test_event_code || env.META_TEST_EVENT_CODE;
  if (testCode) payload.test_event_code = testCode;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.text() };
}

// ============================================================
// GA4 — Measurement Protocol (por measurement id)
// ============================================================
const GA4_NAME: Record<string, string> = {
  Lead: "generate_lead",
  Purchase: "purchase",
  CompleteRegistration: "sign_up",
  AddToCart: "add_to_cart",
  InitiateCheckout: "begin_checkout",
  ViewContent: "view_item",
  ScrollDepth: "scroll",
};
export async function sendGa4(ga4: Ga4Secret, ev: NormalizedEvent): Promise<DestResult> {
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${ga4.public_id}&api_secret=${ga4.api_secret}`;
  const body = {
    client_id: ev.ga_client_id || ev.event_id,
    events: [
      {
        name: GA4_NAME[ev.event_name] || "generate_lead",
        params: {
          engagement_time_msec: 1,
          ...(ev.custom as Record<string, unknown>),
          ...(ev.gclid ? { gclid: ev.gclid } : {}),
          ...(ev.utms || {}),
        },
      },
    ],
  };
  const r = await fetch(url, { method: "POST", body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
}

// ============================================================
// GOOGLE ADS — upload direto de ClickConversion (caminho avançado, exige gclid + OAuth)
// ============================================================
async function gadsAccessToken(ads: AdsSecret): Promise<string | undefined> {
  if (!ads.client_id || !ads.client_secret || !ads.refresh_token) return undefined;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ads.client_id,
      client_secret: ads.client_secret,
      refresh_token: ads.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return undefined;
  const j = (await r.json()) as { access_token?: string };
  return j.access_token;
}
function gadsDateTime(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(
    d.getUTCMinutes(),
  )}:${p(d.getUTCSeconds())}+00:00`;
}
export async function sendGoogleAds(ads: AdsSecret, ev: NormalizedEvent): Promise<DestResult> {
  if (!ev.gclid || !ads.public_id || !ads.developer_token || !ads.conversion_action) {
    return { status: 0, body: "skipped" };
  }
  const token = await gadsAccessToken(ads);
  if (!token) return { status: 0, body: "skipped:no-oauth" };

  const customer = ads.public_id.replace(/\D/g, ""); // só dígitos
  const url = `https://googleads.googleapis.com/v18/customers/${customer}:uploadClickConversions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": ads.developer_token,
    "Content-Type": "application/json",
  };
  if (ads.login_customer_id) headers["login-customer-id"] = ads.login_customer_id.replace(/\D/g, "");

  const body = {
    conversions: [
      {
        gclid: ev.gclid,
        conversionAction: `customers/${customer}/conversionActions/${ads.conversion_action}`,
        conversionDateTime: gadsDateTime(ev.event_time * 1000),
        conversionValue: (ev.custom.value as number) ?? 0,
        currencyCode: (ev.custom.currency as string) ?? "BRL",
      },
    ],
    partialFailure: true,
  };
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
}
