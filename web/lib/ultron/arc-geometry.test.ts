import { describe, expect, it } from "vitest";
import {
  CASCADE_STEP,
  MIN_H,
  MIN_W,
  clampRect,
  defaultRect,
  defaultWidth,
  maxHeight,
  maxWidth,
  type ContainerSize,
} from "./arc-geometry";

const CONTAINER: ContainerSize = { width: 1920, height: 1080 };

describe("defaultWidth", () => {
  it("maps size tokens to the seed widths", () => {
    expect(defaultWidth("default")).toBe(460);
    expect(defaultWidth("wide")).toBe(600);
  });
});

describe("defaultRect", () => {
  it("cascades the position by stack index", () => {
    const first = defaultRect(0, "default", CONTAINER);
    const second = defaultRect(1, "default", CONTAINER);
    expect(second.x - first.x).toBe(CASCADE_STEP);
    expect(second.y - first.y).toBe(CASCADE_STEP);
  });

  it("seeds auto height (null) so the body sizes to content", () => {
    expect(defaultRect(0, "wide", CONTAINER).h).toBeNull();
  });

  it("keeps the seeded panel fully inside the container", () => {
    const rect = defaultRect(0, "wide", CONTAINER);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(CONTAINER.width);
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
