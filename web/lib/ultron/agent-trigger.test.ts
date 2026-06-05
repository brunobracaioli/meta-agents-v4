import { describe, expect, it } from "vitest";
import { isLiveReviewSignal, liveReviewKey, type LiveReviewSignal } from "@/lib/ultron/agent-trigger";

// The LiveReviewSignal contract is the seam between the server tool (request_live_review),
// the chat extraction (liveReviewFromToolResult), and the browser fan-out dedup
// (publishLiveReviews). If the guard drifts, signals silently stop reaching the overlay.

const VALID: LiveReviewSignal = {
  landingPageId: "11111111-1111-1111-1111-111111111111",
  previewUrl: "/lp-preview/11111111-1111-1111-1111-111111111111?review=1",
  at: "2026-06-04T12:00:00.000Z",
};

describe("isLiveReviewSignal", () => {
  it("accepts a well-formed signal", () => {
    expect(isLiveReviewSignal(VALID)).toBe(true);
  });

  it("ignores extra fields (the tool result carries start_review/message too)", () => {
    expect(isLiveReviewSignal({ ...VALID, start_review: true, message: "oi" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["missing landingPageId", { previewUrl: VALID.previewUrl, at: VALID.at }],
    ["empty landingPageId", { ...VALID, landingPageId: "" }],
    ["missing previewUrl", { landingPageId: VALID.landingPageId, at: VALID.at }],
    ["missing at", { landingPageId: VALID.landingPageId, previewUrl: VALID.previewUrl }],
    ["non-string previewUrl", { ...VALID, previewUrl: 123 }],
  ])("rejects %s", (_label, value) => {
    expect(isLiveReviewSignal(value)).toBe(false);
  });
});

describe("liveReviewKey", () => {
  it("is stable for the same signal and unique per (id, url, at)", () => {
    expect(liveReviewKey(VALID)).toBe(liveReviewKey({ ...VALID }));
    expect(liveReviewKey(VALID)).not.toBe(liveReviewKey({ ...VALID, at: "2026-06-04T12:00:01.000Z" }));
  });
});
