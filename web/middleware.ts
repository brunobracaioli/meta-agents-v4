import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { createSupabaseServerClient, OPERATOR_ID_HEADER, type CookieToSet } from "@/lib/auth/supabase";

// Routes that must NOT require a session (the unauthenticated auth endpoints).
const PUBLIC_API = ["/api/auth/login", "/api/auth/signup"];

// Cloudflare Turnstile (login captcha) loads a script and renders its challenge in an
// <iframe>, and the widget makes XHRs back to this host — so it needs script/frame/connect.
const CF_TURNSTILE = "https://challenges.cloudflare.com";

function buildCsp(nonce: string, isProd: boolean, allowSameOriginFrame: boolean): string {
  // In prod we use a per-request nonce + 'strict-dynamic' so Next.js's inline
  // bootstrap/hydration scripts run WITHOUT 'unsafe-inline'. In dev, HMR needs
  // 'unsafe-inline'/'unsafe-eval', so we relax there only. The Turnstile host is listed
  // for browsers that don't honor 'strict-dynamic' (and for dev, which has no nonce).
  // 'wasm-unsafe-eval' lets the MediaPipe face-tracking runtime compile its WebAssembly
  // (on the Ultron tab). It is far narrower than 'unsafe-eval' — it permits wasm only, not
  // arbitrary JS eval. Dev already allows 'unsafe-eval' (which covers wasm) for HMR.
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' ${CF_TURNSTILE}`
    : `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${CF_TURNSTILE}`;
  // The landing-page preview is embedded in an <iframe> by the dashboard editor on the
  // SAME origin, so it must permit same-origin framing; every other route stays 'none'.
  const frameAncestors = allowSameOriginFrame ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
  return [
    "default-src 'self'",
    "img-src 'self' https://*.supabase.co data: blob:",
    "media-src 'self' blob:",
    // `blob:` is required by THREE.GLTFLoader: it extracts the textures embedded in the
    // .glb (the 3D Ultron avatar) into in-memory blob: URLs and fetches them via
    // ImageBitmapLoader, which is governed by connect-src. Blob URLs are same-origin and
    // page-created, so this does not widen the exfiltration surface.
    // wss://api.openai.com: the browser streams mic audio to OpenAI Realtime for live STT
    // (ADR 0032), authenticating with a short-lived ephemeral token minted by /api/ultron/stt-token.
    `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co wss://api.openai.com ${CF_TURNSTILE}`,
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // 'self' is required for the dashboard editor's same-origin /lp-preview iframe;
    // an explicit frame-src REPLACES the default-src fallback, so it must be listed.
    `frame-src 'self' ${CF_TURNSTILE}`,
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    frameAncestors,
    "form-action 'self'",
  ].join("; ");
}

function applyStaticHeaders(
  res: NextResponse,
  csp: string,
  isProd: boolean,
  allowSameOriginFrame: boolean,
): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  // SAMEORIGIN (not DENY) for the preview so the same-origin editor iframe can load it.
  res.headers.set("X-Frame-Options", allowSameOriginFrame ? "SAMEORIGIN" : "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // camera=(self): the 3D Ultron tab does on-device webcam face tracking (opt-in) so the
  // avatar can look at the user. Frames never leave the browser (MediaPipe runs locally).
  res.headers.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=(self), display-capture=(self)");
  if (isProd) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isProd = process.env.NODE_ENV === "production";
  const nonce = isProd ? crypto.randomUUID() : "";
  const isPreview = pathname.startsWith("/lp-preview");
  const csp = buildCsp(nonce, isProd, isPreview);

  const isApi = pathname.startsWith("/api");
  const isPublicApi = PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // The preview shows draft (unpublished) content, so it requires a session too. /arc-popout is
  // the ARC second-screen surface (SPEC-019 C.2b): it lives outside /dashboard to skip the voice
  // layout, but renders client data, so it MUST be auth-gated just like the dashboard.
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/arc-popout") ||
    isPreview ||
    (isApi && !isPublicApi);

  // Auth gate for protected routes. AUTH_MODE=supabase verifies the per-operator session
  // (ADR 0026) and may refresh tokens — those refreshed cookies are collected here and
  // applied to whatever response we return. Default "password" keeps the legacy jose gate.
  const authMode = process.env.AUTH_MODE === "supabase" ? "supabase" : "password";
  const pendingCookies: CookieToSet[] = [];
  // The operator verified by the supabase gate below, forwarded to handlers so they never call
  // getUser() again (avoids the refresh-token rotation race that silently nulled operator_id).
  let resolvedOperatorId: string | null = null;

  if (isProtected) {
    let ok: boolean;
    if (authMode === "supabase") {
      const supabase = createSupabaseServerClient({
        getAll: () => req.cookies.getAll().map(({ name, value }) => ({ name, value })),
        setAll: (cookies) => {
          for (const ck of cookies) {
            req.cookies.set(ck.name, ck.value);
            pendingCookies.push(ck);
          }
        },
      });
      const { data } = await supabase.auth.getUser();
      resolvedOperatorId = data.user?.id ?? null;
      ok = Boolean(data.user);
    } else {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      ok = await verifySessionToken(token, process.env.AUTH_SECRET ?? "");
    }
    if (!ok) {
      const unauth = isApi
        ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
        : NextResponse.redirect(new URL("/login", req.url));
      for (const ck of pendingCookies) unauth.cookies.set({ name: ck.name, value: ck.value, ...ck.options });
      return applyStaticHeaders(unauth, csp, isProd, isPreview);
    }
  }

  // Pass the nonce + CSP on the REQUEST headers so Next.js stamps its scripts with
  // the nonce (and renders dynamically for that request).
  const requestHeaders = new Headers(req.headers);
  // Identity passthrough: drop any client-supplied value (anti-spoof) and re-stamp with the
  // operator the gate just verified, so handlers read identity from here, not a second getUser().
  requestHeaders.delete(OPERATOR_ID_HEADER);
  if (resolvedOperatorId) requestHeaders.set(OPERATOR_ID_HEADER, resolvedOperatorId);
  if (isProd) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  for (const ck of pendingCookies) res.cookies.set({ name: ck.name, value: ck.value, ...ck.options });
  return applyStaticHeaders(res, csp, isProd, isPreview);
}

export const config = {
  // Run on app routes and API, skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
