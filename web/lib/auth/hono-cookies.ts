import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { OPERATOR_ID_HEADER, type CookieAdapter } from "@/lib/auth/supabase";

/**
 * The current operator's id as resolved ONCE by the middleware (auth.uid() in AUTH_MODE=supabase),
 * forwarded on the request as a server-trusted header. Returns null in password mode (single-tenant)
 * or when the middleware did not stamp it. Route handlers must use this instead of calling
 * `supabase.auth.getUser()` again — see OPERATOR_ID_HEADER for the refresh-token race it avoids.
 *
 * Trust model: safe to read directly because every matched route passes through the middleware,
 * which strips any inbound value and only re-stamps after verifying the session.
 */
export function operatorIdFromRequest(c: Context): string | null {
  return c.req.header(OPERATOR_ID_HEADER) ?? null;
}

/**
 * Bridges Hono's cookie helpers to the @supabase/ssr cookie adapter so the auth session
 * is stored in httpOnly cookies (no token ever reaches client JS). Lives in its own module
 * (not route.ts) so route handlers AND the landing-pages sub-router can share it without a
 * circular import — route.ts imports the sub-router, so the sub-router can't import route.ts.
 */
export function honoCookieAdapter(c: Context): CookieAdapter {
  return {
    getAll() {
      const all = getCookie(c);
      return Object.entries(all).map(([name, value]) => ({ name, value }));
    },
    setAll(cookies) {
      for (const { name, value, options } of cookies) {
        // @supabase/ssr's CookieOptions.sameSite allows boolean; Hono's serializer does
        // not. The shapes are otherwise compatible, so cast to Hono's option type.
        setCookie(c, name, value, options as Parameters<typeof setCookie>[3]);
      }
    },
  };
}
