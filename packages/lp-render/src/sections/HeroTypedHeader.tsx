"use client";

import { useEffect, useState } from "react";

// Typewriter headline, ported from claude-code.b2tech.io. Reveals `text` one character at a
// time with a blinking caret. Starts from a deterministic 0-revealed state so the server
// render and the first client render match; the effect then advances the count. Respects
// prefers-reduced-motion (completes immediately). Styling is plain CSS (.hero-caret /
// .sr-only in globals.css) — lp-render has no Tailwind.

interface TypedHeaderProps {
  text: string;
  className?: string;
}

/** Average delay (ms) between revealing each character. */
const BASE_CHAR_DELAY_MS = 28;
/** Random jitter (ms) added per character for a more natural typing rhythm. */
const CHAR_DELAY_JITTER_MS = 12;

function useTypedText(text: string): number {
  const [revealed, setRevealed] = useState<number>(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReducedMotion) {
      setRevealed(text.length);
      return;
    }

    setRevealed(0);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = (count: number): void => {
      if (count >= text.length) {
        return;
      }
      const delay = BASE_CHAR_DELAY_MS + Math.random() * CHAR_DELAY_JITTER_MS;
      timer = setTimeout(() => {
        const next = count + 1;
        setRevealed(next);
        scheduleNext(next);
      }, delay);
    };

    scheduleNext(0);

    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [text]);

  return revealed;
}

export function HeroTypedHeader({ text, className }: TypedHeaderProps): React.JSX.Element {
  const revealed = useTypedText(text);
  const visibleText = text.slice(0, revealed);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {visibleText}
        <span className="hero-caret" />
      </span>
    </span>
  );
}
