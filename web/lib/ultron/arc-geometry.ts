// SPEC-019 Wave E — pure geometry helpers for the ARC floating panels.
//
// Kept framework-free (no React) so it can be unit-tested in the node vitest env. The
// draggable/resizable `HoloPanel` owns the live geometry in local state and uses these to
// seed a panel's initial rect (cascade) and to clamp drag/resize within the stage. A panel's
// height is `null` until the user resizes it (auto-height from content); once a number, the
// body scrolls inside the fixed height.
import { type PanelSize } from "@/components/arc/holo-panel.types";

export type PanelRect = { x: number; y: number; w: number; h: number | null };
export type ContainerSize = { width: number; height: number };

// Min panel footprint, and how far each new panel cascades from the previous one.
export const MIN_W = 260;
export const MIN_H = 160;
export const CASCADE_STEP = 34;
// Keep panels off the very edges (the ARC top strip lives around y≈0..56).
const MARGIN = 12;
const TOP_OFFSET = 64;

// Default seed width per size token — mirrors the previous fixed `HoloPanel` widths.
export function defaultWidth(size: PanelSize): number {
  return size === "wide" ? 600 : 460;
}

// Largest width/height a panel may occupy in the given container (never below the minimum).
export function maxWidth(container: ContainerSize): number {
  return Math.max(MIN_W, container.width - MARGIN * 2);
}
export function maxHeight(container: ContainerSize): number {
  return Math.max(MIN_H, container.height - MARGIN * 2);
}

// Clamp a value into [lo, hi], tolerating an inverted range (hi < lo → returns lo).
function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, value));
}

// Seed rect for a freshly-shown panel: a centred-top cascade stepped by stack index, with the
// width clamped to the container and the position kept fully inside it.
export function defaultRect(index: number, size: PanelSize, container: ContainerSize): PanelRect {
  const w = clamp(defaultWidth(size), MIN_W, maxWidth(container));
  const step = index * CASCADE_STEP;
  const x = (container.width - w) / 2 + step;
  const y = TOP_OFFSET + step;
  return clampRect({ x, y, w, h: null }, container);
}

// Clamp a rect's size to [min, max] and its position so the panel stays inside the container.
// `h: null` (auto height) is preserved; a numeric height is clamped like the width.
export function clampRect(rect: PanelRect, container: ContainerSize): PanelRect {
  const w = clamp(rect.w, MIN_W, maxWidth(container));
  const h = rect.h === null ? null : clamp(rect.h, MIN_H, maxHeight(container));
  const usedH = h ?? MIN_H;
  const x = clamp(rect.x, MARGIN, Math.max(MARGIN, container.width - w - MARGIN));
  const y = clamp(rect.y, MARGIN, Math.max(MARGIN, container.height - usedH - MARGIN));
  return { x, y, w, h };
}
