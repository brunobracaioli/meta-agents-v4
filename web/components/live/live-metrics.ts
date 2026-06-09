import type { LiveEvent } from "./neural-core-state";

const MINUTE_MS = 60_000;

export const SPARKLINE_WINDOW_MINUTES = 15;
export const SPECTRUM_WINDOW_MS = 5 * MINUTE_MS;

export const SPECTRUM_EVENT_TYPES = ["start", "step", "decision", "error", "end"] as const;
export type SpectrumEventType = (typeof SPECTRUM_EVENT_TYPES)[number];

/**
 * Events-per-minute histogram for the trailing window, oldest bucket first.
 * The last bucket is the (partial) current minute.
 */
export function bucketEventsPerMinute(
  events: LiveEvent[],
  nowMs: number,
  windowMinutes: number = SPARKLINE_WINDOW_MINUTES,
): number[] {
  const buckets = new Array<number>(windowMinutes).fill(0);
  const windowStartMs = nowMs - windowMinutes * MINUTE_MS;
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (Number.isNaN(ts) || ts <= windowStartMs || ts > nowMs) continue;
    const index = Math.min(windowMinutes - 1, Math.floor((ts - windowStartMs) / MINUTE_MS));
    const bucket = buckets[index];
    if (bucket !== undefined) buckets[index] = bucket + 1;
  }
  return buckets;
}

/** Events seen in the last 60s. */
export function eventsPerMinuteNow(events: LiveEvent[], nowMs: number): number {
  let count = 0;
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (!Number.isNaN(ts) && ts > nowMs - MINUTE_MS && ts <= nowMs) count += 1;
  }
  return count;
}

/** Counts by event_type inside the trailing window (unknown types ignored). */
export function eventTypeCounts(
  events: LiveEvent[],
  nowMs: number,
  windowMs: number = SPECTRUM_WINDOW_MS,
): Record<SpectrumEventType, number> {
  const counts: Record<SpectrumEventType, number> = { start: 0, step: 0, decision: 0, error: 0, end: 0 };
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (Number.isNaN(ts) || ts <= nowMs - windowMs || ts > nowMs) continue;
    if ((SPECTRUM_EVENT_TYPES as readonly string[]).includes(event.event_type)) {
      counts[event.event_type as SpectrumEventType] += 1;
    }
  }
  return counts;
}
