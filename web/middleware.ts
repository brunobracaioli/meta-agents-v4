import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Routes that must NOT require a session.
const PUBLIC_API = ["/api/auth/login"];

function securityHeaders(res: NextResponse): NextResponse {
  const isProd = process.env.NODE_ENV === "production";
  const csp = [
    "default-src 'self'",
    "img-src 'self' https://*.supabase.co data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    // 'wasm-unsafe-eval' is needed by the Porcupine wake-word WASM (phase 2).
    // Dev needs 'unsafe-eval' for HMR; keep it out of prod.
    isProd
      ? "script-src 'self' 'wasm-unsafe-eval'"
      : "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  if (isProd) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const isApi = pathname.startsWith("/api");
  const isPublicApi = PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isProtected = pathname.startsWith("/dashboard") || (isApi && !isPublicApi);

  if (!isProtected) {
    return securityHeaders(NextResponse.next());
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySessionToken(token, process.env.AUTH_SECRET ?? "");

  if (!ok) {
    if (isApi) {
      return securityHeaders(
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      );
    }
    const loginUrl = new URL("/login", req.url);
    return securityHeaders(NextResponse.redirect(loginUrl));
  }

  return securityHeaders(NextResponse.next());
}

export const config = {
  // Run on app routes and API, skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
