import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Routes that must NOT require a session.
const PUBLIC_API = ["/api/auth/login"];

function buildCsp(nonce: string, isProd: boolean): string {
  // In prod we use a per-request nonce + 'strict-dynamic' so Next.js's inline
  // bootstrap/hydration scripts run WITHOUT 'unsafe-inline'. In dev, HMR needs
  // 'unsafe-inline'/'unsafe-eval', so we relax there only.
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
  return [
    "default-src 'self'",
    "img-src 'self' https://*.supabase.co data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

function applyStaticHeaders(res: NextResponse, csp: string, isProd: boolean): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self), display-capture=(self)");
  if (isProd) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isProd = process.env.NODE_ENV === "production";
  const nonce = isProd ? crypto.randomUUID() : "";
  const csp = buildCsp(nonce, isProd);

  const isApi = pathname.startsWith("/api");
  const isPublicApi = PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isProtected = pathname.startsWith("/dashboard") || (isApi && !isPublicApi);

  // Auth gate for protected routes.
  if (isProtected) {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const ok = await verifySessionToken(token, process.env.AUTH_SECRET ?? "");
    if (!ok) {
      if (isApi) {
        return applyStaticHeaders(NextResponse.json({ error: "unauthorized" }, { status: 401 }), csp, isProd);
      }
      return applyStaticHeaders(NextResponse.redirect(new URL("/login", req.url)), csp, isProd);
    }
  }

  // Pass the nonce + CSP on the REQUEST headers so Next.js stamps its scripts with
  // the nonce (and renders dynamically for that request).
  const requestHeaders = new Headers(req.headers);
  if (isProd) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  return applyStaticHeaders(res, csp, isProd);
}

export const config = {
  // Run on app routes and API, skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
