import type { CSSProperties, ReactNode } from "react";

// Pure-CSS infinite marquee: renders its children twice (the duplicate is aria-hidden)
// and translates -50% so the loop is seamless. Pauses on hover; CSS disables the
// animation under prefers-reduced-motion. See ADR 0013.
export function Marquee({ children, speedSeconds = 42 }: { children: ReactNode; speedSeconds?: number }) {
  return (
    <div className="marquee">
      <div className="marquee-track" style={{ "--marquee-speed": `${speedSeconds}s` } as CSSProperties}>
        <div className="marquee-group">{children}</div>
        <div className="marquee-group" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
