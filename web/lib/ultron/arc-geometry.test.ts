import { describe, expect, it } from "vitest";
import {
  MARGIN,
  MIN_H,
  MIN_W,
  SLOT_COUNT,
  TOP_OFFSET,
  clampRect,
  defaultWidth,
  maxHeight,
  maxWidth,
  slotEntrance,
  slotRect,
  type ContainerSize,
} from "./arc-geometry";

const CONTAINER: ContainerSize = { width: 1920, height: 1080 };

describe("defaultWidth", () => {
  it("maps size tokens to the seed widths", () => {
    expect(defaultWidth("default")).toBe(460);
    expect(defaultWidth("wide")).toBe(600);
  });
});

describe("slotRect", () => {
  it("anchors slot 0 to the top-left corner", () => {
    const rect = slotRect(0, "default", CONTAINER);
    expect(rect.x).toBe(MARGIN);
    expect(rect.y).toBe(TOP_OFFSET);
  });

  it("anchors slot 1 to the top-right corner", () => {
    const rect = slotRect(1, "default", CONTAINER);
    expect(rect.x).toBe(CONTAINER.width - rect.w - MARGIN);
    expect(rect.y).toBe(TOP_OFFSET);
  });

  it("places the bottom slots in the lower band, fully inside the container", () => {
    const bl = slotRect(2, "default", CONTAINER);
    const br = slotRect(3, "default", CONTAINER);
    expect(bl.x).toBe(MARGIN);
    expect(br.x).toBe(CONTAINER.width - br.w - MARGIN);
    expect(bl.y).toBeGreaterThan(TOP_OFFSET);
    // Estimated footprint stays on-screen.
    expect(bl.y + CONTAINER.height * 0.38).toBeLessThanOrEqual(CONTAINER.height);
  });

  it("puts the four corners at distinct positions", () => {
    const tl = slotRect(0, "default", CONTAINER);
    const tr = slotRect(1, "default", CONTAINER);
    const bl = slotRect(2, "default", CONTAINER);
    expect(tl.x).not.toBe(tr.x); // left vs right column
    expect(tl.y).not.toBe(bl.y); // top vs bottom band
  });

  it("bottom-anchors a slot to the measured height when provided", () => {
    const measuredH = 300;
    const rect = slotRect(2, "default", CONTAINER, measuredH);
    expect(rect.y + measuredH).toBe(CONTAINER.height - MARGIN);
  });

  it("seeds auto height (null) regardless of the anchoring height", () => {
    expect(slotRect(0, "wide", CONTAINER).h).toBeNull();
    expect(slotRect(2, "wide", CONTAINER, 400).h).toBeNull();
  });

  it("wraps an out-of-range slot index back into the slot ring", () => {
    expect(slotRect(SLOT_COUNT, "default", CONTAINER)).toEqual(slotRect(0, "default", CONTAINER));
  });

  it("keeps the seeded panel fully inside the container", () => {
    const rect = slotRect(1, "wide", CONTAINER);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(CONTAINER.width);
  });
});

describe("slotEntrance", () => {
  it("starts a panel pulled toward the centre, ahead of its slot corner", () => {
    const slotTL = slotRect(0, "default", CONTAINER);
    const entryTL = slotEntrance(0, "default", CONTAINER);
    // Top-left slot: entrance sits further right and lower (toward centre).
    expect(entryTL.x).toBeGreaterThan(slotTL.x);
    expect(entryTL.y).toBeGreaterThan(slotTL.y);

    const slotTR = slotRect(1, "default", CONTAINER);
    const entryTR = slotEntrance(1, "default", CONTAINER);
    // Top-right slot: entrance sits further left (toward centre).
    expect(entryTR.x).toBeLessThan(slotTR.x);
  });
});

describe("clampRect — size", () => {
  it("clamps width and height to their minimums", () => {
    const rect = clampRect({ x: 100, y: 100, w: 10, h: 10 }, CONTAINER);
    expect(rect.w).toBe(MIN_W);
    expect(rect.h).toBe(MIN_H);
  });

  it("clamps width and height to the container maximums", () => {
    const rect = clampRect({ x: 0, y: 0, w: 99999, h: 99999 }, CONTAINER);
    expect(rect.w).toBe(maxWidth(CONTAINER));
    expect(rect.h).toBe(maxHeight(CONTAINER));
  });

  it("preserves auto height (null) until the user resizes", () => {
    expect(clampRect({ x: 100, y: 100, w: 400, h: null }, CONTAINER).h).toBeNull();
  });
});

describe("clampRect — position", () => {
  it("pulls an off-screen panel back inside the container", () => {
    const rect = clampRect({ x: 5000, y: 5000, w: 400, h: 300 }, CONTAINER);
    expect(rect.x + rect.w).toBeLessThanOrEqual(CONTAINER.width);
    expect(rect.y + (rect.h ?? MIN_H)).toBeLessThanOrEqual(CONTAINER.height);
  });

  it("never produces NaN/inverted bounds when the container is smaller than the panel", () => {
    const tiny: ContainerSize = { width: 200, height: 150 };
    const rect = clampRect({ x: 50, y: 50, w: 400, h: 400 }, tiny);
    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.y)).toBe(true);
    expect(rect.w).toBe(MIN_W);
    expect(rect.h).toBe(MIN_H);
  });
});
