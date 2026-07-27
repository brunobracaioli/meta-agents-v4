// SPEC-019 Wave E — pure geometry helpers for the ARC floating panels.
//
// Kept framework-free (no React) so it can be unit-tested in the node vitest env. The
// draggable/resizable `HoloPanel` owns the live geometry in local state and uses these to
// seed a panel's initial rect and to clamp drag/resize within the stage. Panels are placed
// into fixed perimeter SLOTS (corners + mid-sides) so the centred Ultron avatar's face stays
// visible. A panel's height is `null` until the user resizes it (auto-height from content);
// once a number, the body scrolls inside the fixed height.
import { type PanelSize } from "@/components/arc/holo-panel.types";

export type PanelRect = { x: number; y: number; w: number; h: number | null };
export type ContainerSize = { width: number; height: number };

// Min panel footprint.
export const MIN_W = 260;
export const MIN_H = 160;
// Keep panels off the very edges (the ARC top strip lives around y≈0..56).
export const MARGIN = 12;
export const TOP_OFFSET = 64;
// How far a panel starts pulled toward the centre before gliding out to its slot corner.
export const SLOT_GLIDE = 56;

// Perimeter slots, in the order the Ultron fills them, leaving the centre clear for the face:
// top-left, top-right, bottom-left, bottom-right, mid-left, mid-right.
export type SlotSpec = { side: "left" | "right"; band: "top" | "middle" | "bottom" };
export const SLOTS = [
  { side: "left", band: "top" },
  { side: "right", band: "top" },
  { side: "left", band: "bottom" },
  { side: "right", band: "bottom" },
  { side: "left", band: "middle" },
  { side: "right", band: "middle" },
] as const satisfies readonly SlotSpec[];
export const SLOT_COUNT = SLOTS.length;

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

// Resolve a (possibly out-of-range) slot index to its spec, wrapping defensively.
function slotSpec(slot: number): SlotSpec {
  const idx = ((slot % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
  return SLOTS[idx] ?? SLOTS[0];
}

// Seed rect for a freshly-shown panel placed at its perimeter slot. Width is clamped to the
// container; height stays `auto` (null). `measuredH` (the rendered panel height, once known)
// is used only to anchor the bottom/middle bands precisely — top-band panels grow downward
// from `TOP_OFFSET`. When `measuredH` is absent (first paint) a fraction of the stage height
// estimates the footprint so the panel doesn't seed off-screen.
export function slotRect(
  slot: number,
  size: PanelSize,
  container: ContainerSize,
  measuredH?: number,
): PanelRect {
  const w = clamp(defaultWidth(size), MIN_W, maxWidth(container));
  const s = slotSpec(slot);
  const h = measuredH ?? clamp(container.height * 0.38, MIN_H, maxHeight(container));

  const x = s.side === "left" ? MARGIN : container.width - w - MARGIN;
  const y =
    s.band === "top"
      ? TOP_OFFSET
      : s.band === "bottom"
        ? container.height - h - MARGIN
        : (container.height - h) / 2;

  return clampRect({ x, y, w, h: null }, container);
}

// Entrance rect: the slot pulled `SLOT_GLIDE` toward the centre, so a panel materializes
// slightly inward and then glides out to its corner.
export function slotEntrance(slot: number, size: PanelSize, container: ContainerSize): PanelRect {
  const rect = slotRect(slot, size, container);
  const s = slotSpec(slot);
  const dx = s.side === "left" ? SLOT_GLIDE : -SLOT_GLIDE;
  const dy = s.band === "top" ? SLOT_GLIDE : s.band === "bottom" ? -SLOT_GLIDE : 0;
  return clampRect({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }, container);
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
