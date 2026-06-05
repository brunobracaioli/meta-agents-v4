import type { Env } from "./types";
import { cors, rateLimited } from "./lib";
import { handleCollect } from "./collect";
import { handleDashboardData } from "./dashboard";

// Tagging server MULTI-TENANT em track.b2tech.io (ADR 0021). O Worker é amarrado à zona via
// Workers Routes (ver wrangler.toml). Same-site de todas as LPs (*.b2tech.io) → cookies
// first-party. Resolve segredos por `lp_id` (lp_tracking_secrets) e faz fan-out às plataformas.

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") return cors(req, env, new Response(null, { status: 204 }));
    if (path === "/healthy") return new Response("ok");

    if (req.method === "POST" && (path === "/e" || path === "/")) {
      const ip = req.headers.get("CF-Connecting-IP") || "0";
      if (rateLimited(ip)) {
        return cors(req, env, new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "5" },
        }));
      }
      return handleCollect(req, env, ctx);
    }

    // Fallback de borda do dashboard (o painel nativo no web é o primário). Gated por token.
    if (req.method === "GET" && path === "/dash/data") return handleDashboardData(req, env);

    return new Response("not found", { status: 404 });
  },
};
