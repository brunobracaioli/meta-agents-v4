"use client";

// SPEC-019 — base holographic panel, now a free-floating window (Wave E polish).
// A panel materializes (scale + blur + glow) and dematerializes on exit via framer-motion,
// and can be DRAGGED (by its header) and RESIZED (bottom-right handle) like a Stark-style
// window. Visual language reuses the HUD utility classes from globals.css.
//
// Geometry (x/y/w/h) is LOCAL and lives in framer MOTION VALUES, deliberately kept out of the
// Render Bus: drag/resize are high-frequency and the bus must not thrash the imperative
// lip-sync loop (ADR 0031); motion values also drive the DOM imperatively, so a React
// re-render (focus reorder, data re-show) never clobbers a user's drag/resize. A new panel
// seeds at its perimeter SLOT (via `arc-geometry.slotRect`) — corners + mid-sides, with the
// centre left clear for the avatar's face — materializing slightly inward and gliding out to
// the corner. Geometry is clamped to the stage on every commit so a panel can never be lost
// off-screen. Honours prefers-reduced-motion (no glide).
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { type Anchor } from "@/lib/ultron/render-intents";
import {
  clampRect,
  slotEntrance,
  slotRect,
  type ContainerSize,
  type PanelRect,
} from "@/lib/ultron/arc-geometry";
import { type PanelSize } from "./holo-panel.types";

export type { PanelSize } from "./holo-panel.types";

function getContainerSize(ref: React.RefObject<HTMLElement | null>): ContainerSize {
  const el = ref.current;
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
  }
  if (typeof window !== "undefined") return { width: window.innerWidth, height: window.innerHeight };
  return { width: 1280, height: 720 };
}

export function HoloPanel({
  title,
  anchor: _anchor = "center",
  size = "default",
  focused = false,
  slot,
  zIndex,
  constraintsRef,
  onFocus,
  onDismiss,
  children,
}: {
  title: string;
  // Reserved for viewport anchoring; the seed position is driven by the panel's slot.
  anchor?: Anchor;
  size?: PanelSize;
  focused?: boolean;
  slot: number;
  zIndex: number;
  constraintsRef: React.RefObject<HTMLElement | null>;
  onFocus: () => void;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Seed the rect once at the slot entrance (pulled slightly toward centre), measuring the
  // stage if it's mounted yet. A mount effect then glides x/y out to the slot corner.
  const seed = useMemo<PanelRect>(
    () => slotEntrance(slot, size, getContainerSize(constraintsRef)),
    // Intentionally seed-once: later slot/size changes must not relocate a moved panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const x = useMotionValue(seed.x);
  const y = useMotionValue(seed.y);
  const widthMV = useMotionValue<number>(seed.w);
  // Height is "auto" (sized to content) until the user resizes — then a fixed px height with
  // an internal scroll. `heightRef` holds the logical height (number | null) for clamp math.
  const heightMV = useMotionValue<number | "auto">(seed.h === null ? "auto" : seed.h);
  const heightRef = useRef<number | null>(seed.h);
  const resizeSession = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  // On mount, measure the rendered height and glide x/y from the entrance to the slot corner
  // (bottom/middle bands anchor to the real height). Reduced motion → snap, no glide.
  useLayoutEffect(() => {
    const target = slotRect(
      slot,
      size,
      getContainerSize(constraintsRef),
      panelRef.current?.offsetHeight,
    );
    if (reduce) {
      x.set(target.x);
      y.set(target.y);
      return;
    }
    const spring = { type: "spring", stiffness: 260, damping: 30 } as const;
    const cx = animate(x, target.x, spring);
    const cy = animate(y, target.y, spring);
    return () => {
      cx.stop();
      cy.stop();
    };
    // Mount-only: positions the panel at its slot once; drag/resize own x/y afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRect = (next: PanelRect) => {
    const r = clampRect(next, getContainerSize(constraintsRef));
    x.set(r.x);
    y.set(r.y);
    widthMV.set(r.w);
    heightRef.current = r.h;
    heightMV.set(r.h === null ? "auto" : r.h);
  };

  const handleDragEnd = (_e: PointerEvent, _info: PanInfo) => {
    applyRect({ x: x.get(), y: y.get(), w: widthMV.get(), h: heightRef.current });
  };

  const startResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onFocus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const currentH = heightRef.current ?? panelRef.current?.getBoundingClientRect().height ?? 0;
    resizeSession.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: widthMV.get(),
      startH: currentH,
    };
  };

  const onResizeMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = resizeSession.current;
    if (!s) return;
    applyRect({
      x: x.get(),
      y: y.get(),
      w: s.startW + (e.clientX - s.startX),
      h: s.startH + (e.clientY - s.startY),
    });
  };

  const endResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    resizeSession.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const resetRect = () =>
    applyRect(slotRect(slot, size, getContainerSize(constraintsRef), panelRef.current?.offsetHeight));

  return (
    <motion.div
      ref={panelRef}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.04}
      dragConstraints={constraintsRef}
      onDragEnd={handleDragEnd}
      onPointerDown={onFocus}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: "blur(8px)" }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(8px)" }}
      transition={reduce ? { duration: 0.15 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      style={{ position: "absolute", left: 0, top: 0, x, y, width: widthMV, height: heightMV, zIndex }}
      className="pointer-events-auto"
    >
      <div
        className={`hud-clip hud-frame h-full p-px transition-shadow ${
          focused
            ? "shadow-[0_0_44px_rgba(103,232,249,0.38)]"
            : "shadow-[0_0_22px_rgba(103,232,249,0.14)]"
        }`}
      >
        <div className="hud-clip hud-frame-bg relative flex h-full flex-col overflow-hidden">
          <div className="hud-scanlines pointer-events-none absolute inset-0 opacity-70" />
          <header
            onPointerDown={(e) => dragControls.start(e)}
            onDoubleClick={resetRect}
            className={`relative flex shrink-0 cursor-grab touch-none select-none items-center justify-between gap-3 border-b px-4 py-2.5 transition-colors active:cursor-grabbing ${
              focused ? "border-cyan-300/40 bg-cyan-300/[0.06]" : "border-cyan-300/15"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                  focused ? "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]" : "bg-cyan-300/35"
                }`}
              />
              <span className="truncate font-hud text-xs uppercase tracking-[0.22em] text-cyan-100/85">
                {title}
              </span>
            </span>
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Dispensar painel"
                className="grid h-6 w-6 shrink-0 place-items-center rounded border border-cyan-300/25 font-hud text-xs text-cyan-100/70 transition hover:border-cyan-200/60 hover:text-cyan-50"
              >
                ✕
              </button>
            ) : null}
          </header>
          <div className="relative min-h-0 flex-1 overflow-auto px-4 py-3 text-sm text-cyan-50/90">
            {children}
          </div>
          {/* Resize handle — bottom-right corner. Pointer events are its own (stops drag/focus). */}
          <button
            type="button"
            aria-label="Redimensionar painel"
            onPointerDown={startResize}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize touch-none text-cyan-300/50 transition hover:text-cyan-200/90"
          >
            <span aria-hidden className="absolute bottom-1 right-1 text-[0.7rem] leading-none">
              ◢
            </span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
