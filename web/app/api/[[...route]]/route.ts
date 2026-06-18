import { Hono } from "hono";
import { handle } from "hono/vercel";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { createSupabaseServerClient, type CookieAdapter } from "@/lib/auth/supabase";
import { rateLimiters, enforceLimit, clientIp } from "@/lib/ratelimit";
import { transcribe } from "@/lib/ultron/stt";
import { runChat, resumeChat } from "@/lib/ultron/chat";
import { synthesizeStream } from "@/lib/ultron/tts";
import { analyzeReviewFrame } from "@/lib/ultron/review-frame";
import { getEvents, getProcesses } from "@/lib/services/events";
import { getPendingNarrations, markNarrationSpoken } from "@/lib/services/narrations";
import { getAutoReviewCandidate } from "@/lib/services/landing-page";
import { landingPages } from "@/lib/api/landing-pages";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2_500_000; // ~2.5MB; VAD keeps clips short
const MAX_IMAGE_B64 = 4_000_000; // ~3MB decoded; client downscales to ~1280px JPEG

const app = new Hono().basePath("/api");

const loginSchema = z.object({
  password: z.string().min(1).max(200),
  // Cloudflare Turnstile token (cf-turnstile-response). Optional in the schema so the
  // endpoint still works when Turnstile is not configured; enforced below when the
  // secret key is present.
  turnstileToken: z.string().min(1).max(4096).optional(),
});

// AUTH_MODE=supabase: per-operator email + password (ADR 0026).
const supabaseLoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  turnstileToken: z.string().min(1).max(4096).optional(),
});

const supabaseSignupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120).optional(),
  turnstileToken: z.string().min(1).max(4096).optional(),
});

// Bridges Hono's cookie helpers to the @supabase/ssr cookie adapter so the auth session
// is stored in httpOnly cookies (no token ever reaches client JS).
function honoCookieAdapter(c: Context): CookieAdapter {
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

// Shared rate-limit + Turnstile gate for the auth endpoints. Returns a Response to short
// -circuit on failure, or null to proceed.
async function authGate(
  c: Context,
  turnstileToken: string | undefined,
): Promise<Response | null> {
  const ip = clientIp(c.req.raw);
  const { allowed } = await enforceLimit(rateLimiters.login(), ip, "login");
  if (!allowed) {
    return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }
  const turnstileSecret = env.turnstileSecretKey();
  if (turnstileSecret) {
    if (!turnstileToken) return c.json({ error: "captcha_required" }, 400);
    const human = await verifyTurnstile(turnstileToken, turnstileSecret, ip);
    if (!human) return c.json({ error: "captcha_failed" }, 403);
  }
  return null;
}

const chatSchema = z.object({
  sessionId: z.string().min(8).max(64),
  text: z.string().min(1).max(2000),
});

const ttsSchema = z.object({
  text: z.string().min(1).max(2000),
});

const captureSchema = z.object({
  sessionId: z.string().min(8).max(64),
  pendingId: z.string().uuid(),
  image: z.object({
    media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().min(1),
  }),
});

const reviewFrameSchema = z.object({
  image: z.object({
    media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().min(1),
  }),
  label: z.string().min(1).max(120),
  landingPageId: z.string().uuid().optional(),
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);

  if (env.authMode() === "supabase") {
    const parsed = supabaseLoginSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const gate = await authGate(c, parsed.data.turnstileToken);
    if (gate) return gate;

    const supabase = createSupabaseServerClient(honoCookieAdapter(c));
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    // Generic 401 — never reveal whether the email exists.
    if (error) return c.json({ error: "unauthorized" }, 401);
    return c.json({ ok: true });
  }

  // Legacy single-password gate (ADR 0006).
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  const gate = await authGate(c, parsed.data.turnstileToken);
  if (gate) return gate;

  const ok = await verifyPassword(parsed.data.password, env.dashboardPasswordHash());
  if (!ok) return c.json({ error: "unauthorized" }, 401);

  const token = await createSessionToken(env.authSecret());
  setCookie(c, SESSION_COOKIE, token, { ...sessionCookieOptions });
  return c.json({ ok: true });
});

// Operator self-signup (AUTH_MODE=supabase only, and only when explicitly enabled).
// Onboarding is invite/admin-gated by default (threat model): off unless AUTH_ALLOW_SIGNUP.
app.post("/auth/signup", async (c) => {
  if (env.authMode() !== "supabase" || !env.allowSignup()) {
    return c.json({ error: "not_found" }, 404);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = supabaseSignupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  const gate = await authGate(c, parsed.data.turnstileToken);
  if (gate) return gate;

  const supabase = createSupabaseServerClient(honoCookieAdapter(c));
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    ...(parsed.data.displayName
      ? { options: { data: { display_name: parsed.data.displayName } } }
      : {}),
  });
  // The handle_new_operator trigger creates the public.operators row on user insert.
  if (error) return c.json({ error: "signup_failed" }, 400);
  // Depending on project settings the session may require email confirmation first.
  return c.json({ ok: true });
});

app.post("/auth/logout", async (c) => {
  if (env.authMode() === "supabase") {
    const supabase = createSupabaseServerClient(honoCookieAdapter(c));
    await supabase.auth.signOut();
    return c.json({ ok: true });
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---------- Ultron voice pipeline ----------

app.post("/ultron/stt", async (c) => {
  const { allowed } = await enforceLimit(rateLimiters.ultronStt(), clientIp(c.req.raw), "ultron-stt");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  const form = await c.req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob)) return c.json({ error: "invalid_request" }, 400);
  if (audio.size === 0) return c.json({ text: "" });
  if (audio.size > MAX_AUDIO_BYTES) return c.json({ error: "audio_too_large" }, 413);

  try {
    const text = await transcribe(audio);
    return c.json({ text });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "stt_failed", message: errMsg(err) }));
    return c.json({ error: "stt_failed" }, 502);
  }
});

app.post("/ultron/chat", async (c) => {
  const { allowed } = await enforceLimit(rateLimiters.ultronChat(), clientIp(c.req.raw), "ultron-chat");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  const parsed = chatSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  try {
    const result = await runChat(parsed.data.sessionId, parsed.data.text);
    if (result.kind === "need_capture") {
      return c.json({
        status: "need_capture",
        pendingId: result.pendingId,
        usedTools: result.usedTools,
        agentTriggers: result.agentTriggers,
        landingEdits: result.landingEdits,
        liveReviews: result.liveReviews,
      });
    }
    return c.json({
      reply: result.reply,
      usedTools: result.usedTools,
      agentTriggers: result.agentTriggers,
      landingEdits: result.landingEdits,
      liveReviews: result.liveReviews,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "chat_failed", message: errMsg(err) }));
    return c.json({ error: "chat_failed" }, 502);
  }
});

// Resumes a chat turn that paused on capture_screen with the browser's screenshot.
app.post("/ultron/capture", async (c) => {
  const { allowed } = await enforceLimit(rateLimiters.ultronCapture(), clientIp(c.req.raw), "ultron-capture");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  const parsed = captureSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const { data } = parsed.data.image;
  if (data.length > MAX_IMAGE_B64) return c.json({ error: "image_too_large" }, 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return c.json({ error: "invalid_request" }, 400);

  try {
    const result = await resumeChat(parsed.data.sessionId, parsed.data.pendingId, parsed.data.image);
    if (result.kind === "need_capture") {
      return c.json({
        status: "need_capture",
        pendingId: result.pendingId,
        usedTools: result.usedTools,
        agentTriggers: result.agentTriggers,
        landingEdits: result.landingEdits,
        liveReviews: result.liveReviews,
      });
    }
    return c.json({
      reply: result.reply,
      usedTools: result.usedTools,
      agentTriggers: result.agentTriggers,
      landingEdits: result.landingEdits,
      liveReviews: result.liveReviews,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "capture_failed", message: errMsg(err) }));
    return c.json({ error: "chat_failed" }, 502);
  }
});

// One frame of the Live Review (SPEC-014): describe + opine on one section in 1–2 spoken
// sentences. Stateless vision (no chat memory/tools); the browser drives the scroll loop.
app.post("/ultron/review-frame", async (c) => {
  const { allowed } = await enforceLimit(rateLimiters.ultronReview(), clientIp(c.req.raw), "ultron-review");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  const parsed = reviewFrameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const { data } = parsed.data.image;
  if (data.length > MAX_IMAGE_B64) return c.json({ error: "image_too_large" }, 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return c.json({ error: "invalid_request" }, 400);

  try {
    const analysis = await analyzeReviewFrame({ image: parsed.data.image, label: parsed.data.label });
    return c.json({ analysis });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "review_frame_failed", message: errMsg(err) }));
    return c.json({ error: "review_failed" }, 502);
  }
});

app.post("/ultron/tts", async (c) => {
  const { allowed } = await enforceLimit(rateLimiters.ultronTts(), clientIp(c.req.raw), "ultron-tts");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  const parsed = ttsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  try {
    const upstream = await synthesizeStream(parsed.data.text);
    if (!upstream.ok || !upstream.body) {
      console.error(JSON.stringify({ level: "error", event: "tts_failed", status: upstream.status }));
      return c.json({ error: "tts_failed" }, 502);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "tts_failed", message: errMsg(err) }));
    return c.json({ error: "tts_failed" }, 502);
  }
});

// ---------- Live view (agent activity polling) ----------

app.get("/dashboard/events", async (c) => {
  const sinceRaw = c.req.query("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : undefined;
  try {
    const [events, processes] = await Promise.all([getEvents(since), getProcesses()]);
    return c.json({ events, processes, now: new Date().toISOString() });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "events_failed", message: errMsg(err) }));
    return c.json({ error: "events_failed" }, 502);
  }
});

// ---------- Autonomous mode (server→browser narration channel, ADR 0019) ----------
// The operator's tab polls for narrations its watch produced and speaks them via TTS. Same
// polling + service-key pattern as /dashboard/events — RLS stays deny-by-default (no Realtime).

const sessionQuerySchema = z.string().min(8).max(64);

app.get("/ultron/narrations", async (c) => {
  const session = c.req.query("session");
  const parsed = sessionQuerySchema.safeParse(session);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  try {
    const narrations = await getPendingNarrations(parsed.data);
    return c.json({ narrations, now: new Date().toISOString() });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "narrations_failed", message: errMsg(err) }));
    return c.json({ error: "narrations_failed" }, 502);
  }
});

app.patch("/ultron/narrations/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) return c.json({ error: "invalid_request" }, 400);
  try {
    await markNarrationSpoken(id);
    return c.json({ ok: true });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "narration_ack_failed", message: errMsg(err) }));
    return c.json({ error: "narration_ack_failed" }, 502);
  }
});

// Auto-review on completion (SPEC-014 v1): the dashboard polls this; when a freshly-created
// landing page is ready, the browser opens the Live Review overlay. Read-only, session-gated by
// the middleware. Dedup (fire once per id) is the client's job.
app.get("/ultron/live-review/candidate", async (c) => {
  try {
    const candidate = await getAutoReviewCandidate();
    return c.json({ candidate, now: new Date().toISOString() });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "live_review_candidate_failed", message: errMsg(err) }));
    return c.json({ error: "candidate_failed" }, 502);
  }
});

// ---------- Landing-page editor (draft CRUD + publish) ----------
app.route("/landing-pages", landingPages);

app.get("/health", (c) => c.json({ ok: true }));

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}

export const GET = handle(app);
export const POST = handle(app);
// The landing-page editor uses PATCH (sections/theme/settings) and PUT/DELETE (tracking
// secrets). Next route handlers must export each HTTP method explicitly, or Next returns 405
// before Hono ever dispatches — so every verb the Hono app handles needs an export here.
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
