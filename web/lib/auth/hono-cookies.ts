import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { CookieAdapter } from "@/lib/auth/supabase";

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
