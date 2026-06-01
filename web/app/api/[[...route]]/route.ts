import { Hono } from "hono";
import { handle } from "hono/vercel";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { rateLimiters, enforceLimit, clientIp } from "@/lib/ratelimit";
import { transcribe } from "@/lib/ultron/stt";
import { runChat, resumeChat } from "@/lib/ultron/chat";
import { synthesizeStream } from "@/lib/ultron/tts";
import { getEvents, getProcesses } from "@/lib/services/events";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2_500_000; // ~2.5MB; VAD keeps clips short
const MAX_IMAGE_B64 = 4_000_000; // ~3MB decoded; client downscales to ~1280px JPEG

const app = new Hono().basePath("/api");

const loginSchema = z.object({
  password: z.string().min(1).max(200),
});

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

app.post("/auth/login", async (c) => {
  const ip = clientIp(c.req.raw);
  const { allowed } = await enforceLimit(rateLimiters.login(), ip, "login");
  if (!allowed) {
    return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }

  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const ok = await verifyPassword(parsed.data.password, env.dashboardPasswordHash());
  if (!ok) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const token = await createSessionToken(env.authSecret());
  setCookie(c, SESSION_COOKIE, token, { ...sessionCookieOptions });
  return c.json({ ok: true });
});

app.post("/auth/logout", (c) => {
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
      return c.json({ status: "need_capture", pendingId: result.pendingId, usedTools: result.usedTools });
    }
    return c.json({ reply: result.reply, usedTools: result.usedTools });
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
      return c.json({ status: "need_capture", pendingId: result.pendingId, usedTools: result.usedTools });
    }
    return c.json({ reply: result.reply, usedTools: result.usedTools });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "capture_failed", message: errMsg(err) }));
    return c.json({ error: "chat_failed" }, 502);
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

app.get("/health", (c) => c.json({ ok: true }));

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}

export const GET = handle(app);
export const POST = handle(app);
