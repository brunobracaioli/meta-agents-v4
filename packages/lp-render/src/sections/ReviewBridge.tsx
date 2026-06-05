"use client";

import { useEffect } from "react";
import { useContent } from "../content";

// Surface A/B "review bridge" for the Ultron Live Review (SPEC-014 / ADR 0020).
//
// When the page is loaded with `?review=1` inside a dashboard iframe (Surface A: the
// same-origin /lp-preview embed) or a published-page tab (Surface B), this answers a tiny,
// typed `postMessage` protocol so a dashboard orchestrator can drive a section-by-section
// visual review: it reports its scroll layout and smooth-scrolls itself to a requested Y,
// acking when the scroll settles. The orchestrator does the "print" via screen capture and
// narrates by voice — this bridge only reads its own layout and scrolls itself.
//
// SECURITY: inert by default. It attaches NO message listener unless `?review=1` is present,
// and it ignores any message whose `event.origin` is not allowlisted. It never navigates,
// executes code, reads cookies/storage, or posts page content — only layout metrics and scroll
// acks. This keeps the published static template unchanged in normal use (no `?review=1`).
//
// The matching orchestrator lives in web/ (lib/ultron/live-review.ts). Same protocol for both
// surfaces; the lp-render component is shared (see ADR 0017).

// Dashboard origins permitted to drive a review. Same-origin is always allowed (Surface A:
// the preview is served by the dashboard app). The extra entries cover Surface B, where the
// published page (b2tech.io) is driven from the dashboard origin. Vercel preview deploys are
// matched by suffix below. Keep this list tight — it is the spoofing guard (STRIDE §6).
const EXTRA_ALLOWED_ORIGINS: readonly string[] = ["https://meta-agents-v4.vercel.app"];
const ALLOWED_ORIGIN_SUFFIX = ".vercel.app";

interface ReviewStep {
  y: number;
  label: string;
  settleMs: number;
}

const STAGE3D_SETTLE_MS = 2200; // let the GPU paint the hologram/reveal before the "print"
const SECTION_SETTLE_MS = 600;
const SCROLL_SETTLE_TIMEOUT_MS = 1500;

function reviewModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("review") === "1";
  } catch {
    return false;
  }
}

export function ReviewBridge() {
  // Hook is called unconditionally (rules of hooks); the effect is what gates on review mode.
  const { contentSpec, isCartClosed } = useContent();

  useEffect(() => {
    if (!reviewModeEnabled()) return;

    const isAllowedOrigin = (origin: string): boolean => {
      if (origin === window.location.origin) return true;
      if (EXTRA_ALLOWED_ORIGINS.includes(origin)) return true;
      try {
        return new URL(origin).hostname.endsWith(ALLOWED_ORIGIN_SUFFIX);
      } catch {
        return false;
      }
    };

    const maxScrollY = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    // Build the ordered scroll "steps". The optional 3D opening (.stage3d-wrap, 220vh) gets
    // two beats so the cinematic scrub (spin + recede + logo reveal) actually plays. Then one
    // step per rendered <section>, in document order. Section labels come from the cart-state
    // filtered spec order (PageBody drops curriculum/features when the cart is closed), zipped
    // best-effort with the DOM nodes — same assumption the editor's scrollTo already relies on.
    const buildSteps = (): ReviewStep[] => {
      const steps: ReviewStep[] = [];
      const stageWrap = document.querySelector<HTMLElement>(".stage3d-wrap");
      if (contentSpec.stage3d?.model && stageWrap) {
        steps.push({ y: 0, label: "abertura 3D (cena cinematográfica)", settleMs: STAGE3D_SETTLE_MS });
        steps.push({
          y: Math.round(stageWrap.offsetTop + stageWrap.offsetHeight * 0.6),
          label: "abertura 3D (revelação do logo)",
          settleMs: STAGE3D_SETTLE_MS,
        });
      }
      const visible = contentSpec.sections.filter(
        (id) => !(isCartClosed && (id === "curriculum" || id === "features")),
      );
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("section"));
      nodes.forEach((node, i) => {
        steps.push({
          y: Math.round(node.offsetTop),
          label: visible[i] ?? "seção",
          settleMs: SECTION_SETTLE_MS,
        });
      });
      return steps;
    };

    const post = (msg: unknown, targetOrigin: string) => {
      try {
        window.parent?.postMessage(msg, targetOrigin);
      } catch {
        // Cross-origin targetOrigin mismatch is silently dropped by the browser; ignore.
      }
    };

    let rafId: number | null = null;

    // After a smooth-scroll, poll until the scroll position stabilizes near the (clamped)
    // target or a timeout elapses, then ack with the final Y + whether we hit the bottom.
    const ackWhenSettled = (targetY: number, origin: string) => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      const startedAt = performance.now();
      let lastY = Number.NaN;
      const tick = () => {
        const y = window.scrollY;
        const target = Math.min(targetY, maxScrollY());
        const settled = Math.abs(y - target) < 2;
        const stable = Math.abs(y - lastY) < 1;
        lastY = y;
        if ((settled && stable) || performance.now() - startedAt > SCROLL_SETTLE_TIMEOUT_MS) {
          const atBottom =
            y + window.innerHeight >= document.documentElement.scrollHeight - 4;
          post({ type: "review:scrolled", y, atBottom }, origin);
          rafId = null;
          return;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };

    const onMessage = (e: MessageEvent) => {
      if (!isAllowedOrigin(e.origin)) return;
      const data = e.data as { type?: unknown; y?: unknown } | null;
      if (!data || typeof data.type !== "string") return;
      switch (data.type) {
        case "review:hello": {
          post(
            {
              type: "review:layout",
              scrollHeight: document.documentElement.scrollHeight,
              viewportH: window.innerHeight,
              steps: buildSteps(),
            },
            e.origin,
          );
          break;
        }
        case "review:scrollTo": {
          if (typeof data.y !== "number") return;
          const target = Math.min(Math.max(0, data.y), maxScrollY());
          window.scrollTo({ top: target, behavior: "smooth" });
          ackWhenSettled(target, e.origin);
          break;
        }
        case "review:ping": {
          post({ type: "review:pong" }, e.origin);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", onMessage);
    // Announce presence so an orchestrator that mounted first knows it can start (mirrors the
    // editor's lp-preview:ready handshake). Sent only to allowlisted origins, never "*".
    [window.location.origin, ...EXTRA_ALLOWED_ORIGINS].forEach((origin) =>
      post({ type: "review:ready" }, origin),
    );

    return () => {
      window.removeEventListener("message", onMessage);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [contentSpec, isCartClosed]);

  return null;
}
