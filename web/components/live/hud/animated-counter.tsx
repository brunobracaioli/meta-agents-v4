"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

const DEFAULT_DURATION_MS = 450;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useAnimatedNumber(target: number, durationMs: number = DEFAULT_DURATION_MS): number {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  displayRef.current = display;

  useEffect(() => {
    if (reducedMotion || displayRef.current === target) {
      setDisplay(target);
      return;
    }
    const from = displayRef.current;
    let raf = 0;
    let startTs: number | null = null;
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const progress = Math.min(1, (ts - startTs) / durationMs);
      setDisplay(Math.round(from + (target - from) * easeOutCubic(progress)));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reducedMotion]);

  return display;
}

type AnimatedCounterProps = {
  value: number;
  className?: string;
};

/** Number that rolls toward its new value on change (skipped under reduced motion). */
export function AnimatedCounter({ value, className }: AnimatedCounterProps) {
  const display = useAnimatedNumber(value);
  return <span className={className}>{display}</span>;
}
