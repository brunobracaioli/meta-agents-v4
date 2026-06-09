import { memo, type ReactNode } from "react";

const BOOT_STEP_DELAY_MS = 140;

type HudPanelProps = {
  index: string;
  title: string;
  children: ReactNode;
  className?: string;
  /** Sequence position for the boot stagger; omit to skip the boot animation. */
  bootStep?: number;
  /** Optional right-aligned header content (counters, badges). */
  actions?: ReactNode;
};

/** Corner brackets for HUD frames (decorative). */
export function HudCorners({ className = "" }: { className?: string }) {
  const base = "pointer-events-none absolute h-3.5 w-3.5 border-cyan-300/50";
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-0 z-20 ${className}`}>
      <span className={`${base} left-0 top-0 border-l border-t`} />
      <span className={`${base} right-0 top-0 border-r border-t`} />
      <span className={`${base} bottom-0 left-0 border-b border-l`} />
      <span className={`${base} bottom-0 right-0 border-b border-r`} />
    </span>
  );
}

/**
 * Numbered HUD module with cut corners.
 * clip-path clips borders and box-shadow, so the "border" is an outer clipped
 * layer showing through a 1px inset; glow comes from drop-shadow on the frame.
 */
function HudPanelBase({ index, title, children, className = "", bootStep, actions }: HudPanelProps) {
  return (
    <section
      className={`hud-boot relative ${className}`}
      style={bootStep !== undefined ? { animationDelay: `${bootStep * BOOT_STEP_DELAY_MS}ms` } : undefined}
    >
      <div className="hud-clip hud-frame absolute inset-0" aria-hidden />
      <div className="hud-clip hud-frame-bg absolute inset-px" aria-hidden />
      <div className="hud-scanlines pointer-events-none absolute inset-px z-10" aria-hidden />
      <HudCorners />
      <div className="relative z-10 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-hud text-[10px] uppercase tracking-[0.24em] text-cyan-100/60">
            <span className="mr-2 inline-block border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-cyan-200/90">
              {index}
            </span>
            {title}
          </p>
          {actions}
        </header>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

export const HudPanel = memo(HudPanelBase);
