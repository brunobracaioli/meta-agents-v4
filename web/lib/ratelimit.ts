import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/redis";

// One limiter instance per logical bucket. Sliding window keeps cost bounded on
// the paid voice endpoints and slows password brute-force.
const limiters = new Map<string, Ratelimit>();

function limiter(name: string, tokens: number, window: Parameters<typeof Ratelimit.slidingWindow>[1]): Ratelimit {
  const existing = limiters.get(name);
  if (existing) return existing;
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: `rl:${name}`,
    analytics: false,
  });
  limiters.set(name, rl);
  return rl;
}

export const rateLimiters = {
  login: () => limiter("login", 5, "1 m"),
  ultronStt: () => limiter("ultron-stt", 20, "1 m"),
  ultronChat: () => limiter("ultron-chat", 20, "1 m"),
  ultronTts: () => limiter("ultron-tts", 30, "1 m"),
  ultronCapture: () => limiter("ultron-capture", 15, "1 m"),
  // Live Review (SPEC-014) narrates one frame per section (~12/run). Generous but bounded —
  // each call is a paid vision request, keyed by IP like the other voice endpoints.
  ultronReview: () => limiter("ultron-review", 60, "1 m"),
  // Write actions are keyed by client slug (not IP): they enqueue real agent work
  // and, for activation, real ad spend. Tight caps are defence-in-depth on top of the
  // two-turn confirmation and the one-job-per-(client,kind) unique index.
  campaignCreation: () => limiter("campaign-creation", 5, "1 h"),
  campaignActivation: () => limiter("campaign-activation", 3, "1 h"),
  // Landing-page builds are heavy (npm + next build + wrangler deploy) but spend no ad
  // budget and are born noindex — modest cap, same defence-in-depth rationale.
  landingCreation: () => limiter("landing-creation", 5, "1 h"),
  // Draft edits (section/theme/settings PATCH) are cheap Supabase writes from the editor;
  // a generous per-LP cap absorbs debounced autosave while bounding abuse.
  landingEdit: () => limiter("landing-edit", 120, "1 m"),
  // Publish enqueues a heavy build+deploy job — tight cap on top of the per-LP unique index.
  landingPublish: () => limiter("landing-publish", 6, "1 h"),
};

/**
 * Enforces a limiter but **fails open** if Redis is unreachable: a rate-limit
 * backend outage must not take down the endpoint it protects. The miss is logged
 * (structured, no PII) so the degraded state is observable.
 */
export async function enforceLimit(
  rl: Ratelimit,
  key: string,
  bucket: string,
): Promise<{ allowed: boolean }> {
  try {
    const { success } = await rl.limit(key);
    return { allowed: success };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "ratelimit_unavailable",
        bucket,
        message: err instanceof Error ? err.message : "unknown",
      }),
    );
    return { allowed: true };
  }
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
