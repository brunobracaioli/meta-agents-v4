// SPEC-019 (ADR 0031) — contract for the ARC holographic Render Bus.
//
// A `UIIntent` is a declarative directive the Ultron emits (from the chat tool loop or an
// autonomous narration) telling the client which holographic panel to materialize, focus,
// dismiss or pop out. It is the single source of truth for the contract shared by the
// render-tools (server), the chat loop (server) and the Render Bus (client). Payloads are
// carried as `unknown` here and revalidated per-element at panel mount time, keeping the
// transport schema small while pushing rich validation to the boundary that knows the type.
import { z } from "zod";

export const ANCHORS = ["center", "left", "right", "stack"] as const;
export type Anchor = (typeof ANCHORS)[number];

export const RENDER_ELEMENTS = [
  "funnel",
  "daily_summary",
  "clients",
  "client",
  "analyses",
  "creative",
  "landing",
] as const;
export type RenderElement = (typeof RENDER_ELEMENTS)[number];

export const ShowIntentSchema = z.object({
  op: z.literal("show"),
  element: z.enum(RENDER_ELEMENTS),
  id: z.string().min(1),
  anchor: z.enum(ANCHORS).optional(),
  data: z.unknown(),
});

export const DismissIntentSchema = z.object({
  op: z.literal("dismiss"),
  target: z.string().min(1), // a panel id, or "all"
});

export const FocusIntentSchema = z.object({
  op: z.literal("focus"),
  target: z.string().min(1),
});

export const PopoutIntentSchema = z.object({
  op: z.literal("popout"),
  target: z.string().min(1),
});

export const UIIntentSchema = z.discriminatedUnion("op", [
  ShowIntentSchema,
  DismissIntentSchema,
  FocusIntentSchema,
  PopoutIntentSchema,
]);

export type UIIntent = z.infer<typeof UIIntentSchema>;
export type ShowIntent = z.infer<typeof ShowIntentSchema>;

// Cap on concurrently-mounted panels (DoS guard — see threat model §D).
export const MAX_ACTIVE_PANELS = 6;

// Client-boundary parser: accepts an unknown array (tool result / narration payload) and
// returns only the well-formed intents, silently dropping malformed ones. Never throws —
// a bad intent must never break the voice/narration flow (threat model §T).
export function parseUIIntents(raw: unknown): UIIntent[] {
  if (!Array.isArray(raw)) return [];
  const out: UIIntent[] = [];
  for (const item of raw) {
    const parsed = UIIntentSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// Server-boundary extractor: a render-tool returns its directive under a `ui_intent` key in
// its tool result (mirroring how write-tools carry agent triggers). This reads and validates
// that field, returning null for any other tool result or a malformed intent. Pure — kept
// here (no server-only deps) so the chat loop can reuse it and it stays unit-testable.
export function uiIntentFromToolResult(result: unknown): UIIntent | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const raw = (result as Record<string, unknown>).ui_intent;
  if (raw === undefined) return null;
  const parsed = UIIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
