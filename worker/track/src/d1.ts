import type { Env, NormalizedEvent } from "./types";

export interface SendStatus {
  meta: number; // status representativo (200 se todos os pixels OK; senão 1º não-200; 0 = nenhum)
  ga: number;
  ads: number;
  pixels: number; // quantos pixels receberam o evento
}

// Grava o evento p/ o banco de borda (D1). SEM PII crua — só atribuição, flags e saúde do envio.
export async function insertEvent(env: Env, ev: NormalizedEvent, st: SendStatus): Promise<void> {
  const u = ev.utms || {};
  await env.DB.prepare(
    `INSERT OR IGNORE INTO events
      (event_id, lp_id, event_name, event_time, source_url,
       fbp, fbc, gclid,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       ip, country, user_agent,
       value, currency,
       meta_status, ga_status, ads_status, pixels_count,
       has_email, has_phone, created_at)
     VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?, ?,?, ?,?,?,?, ?,?,?)`,
  )
    .bind(
      ev.event_id,
      ev.lp_id,
      ev.event_name,
      ev.event_time,
      ev.event_source_url ?? null,
      ev.user.fbp ?? null,
      ev.user.fbc ?? null,
      ev.gclid ?? null,
      u.utm_source ?? null,
      u.utm_medium ?? null,
      u.utm_campaign ?? null,
      u.utm_content ?? null,
      u.utm_term ?? null,
      ev.user.client_ip_address ?? null,
      ev.country ?? null,
      ev.user.client_user_agent ?? null,
      (ev.custom.value as number) ?? null,
      (ev.custom.currency as string) ?? null,
      st.meta,
      st.ga,
      st.ads,
      st.pixels,
      ev.has_email ? 1 : 0,
      ev.has_phone ? 1 : 0,
      Date.now(),
    )
    .run();
}
