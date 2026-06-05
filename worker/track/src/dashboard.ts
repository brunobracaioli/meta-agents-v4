import type { Env } from "./types";

// Fallback de borda do dashboard de saúde (o painel nativo no web, lendo lp_events, é o
// primário — ADR 0021). JSON-only, protegido por bearer simples. Aceita ?lp_id=... opcional.

function authorized(req: Request, env: Env): boolean {
  if (!env.DASHBOARD_TOKEN) return false;
  const url = new URL(req.url);
  const t = req.headers.get("Authorization")?.replace("Bearer ", "") || url.searchParams.get("token");
  return !!t && t === env.DASHBOARD_TOKEN;
}

export async function handleDashboardData(req: Request, env: Env): Promise<Response> {
  if (!authorized(req, env)) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const lpId = url.searchParams.get("lp_id");
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;

  const where = lpId ? "event_time >= ? AND lp_id = ?" : "event_time >= ?";
  const binds: (string | number)[] = lpId ? [since, lpId] : [since];

  const kpis = await env.DB.prepare(
    `SELECT
       COUNT(*)                                            AS total,
       ROUND(100.0*SUM(has_email)/COUNT(*),1)              AS email_rate,
       ROUND(100.0*SUM(has_phone)/COUNT(*),1)              AS phone_rate,
       ROUND(100.0*SUM(meta_status=200)/COUNT(*),1)        AS capi_ok,
       ROUND(100.0*SUM(utm_source IS NOT NULL)/COUNT(*),1) AS utm_cov
     FROM events WHERE ${where}`,
  )
    .bind(...binds)
    .first();

  const bySource = await env.DB.prepare(
    `SELECT COALESCE(utm_source,'(direto)') AS src, COUNT(*) AS n
     FROM events WHERE ${where} GROUP BY src ORDER BY n DESC LIMIT 10`,
  )
    .bind(...binds)
    .all();

  return new Response(JSON.stringify({ kpis, bySource: bySource.results }), {
    headers: { "Content-Type": "application/json" },
  });
}
