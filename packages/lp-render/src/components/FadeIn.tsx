"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Reveals its children with a fade + rise the first time they scroll into view.
// SSR/static HTML renders the content (just with the .fade-in opacity:0 until hydrated);
// if IntersectionObserver is unavailable it shows immediately. prefers-reduced-motion is
// handled in CSS (globals.css forces opacity:1). See ADR 0013.
export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const classes = ["fade-in", visible ? "is-visible" : "", className].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes}>
      {children}
    </div>
  );
}
