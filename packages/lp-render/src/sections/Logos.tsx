"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

// "Como visto em" strip. Items are media/brand names rendered as muted pills (no logo
// assets required — robust without images). See ADR 0013.
export function Logos({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.logos;
  if (!data || data.items.length === 0) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container">
        {data.heading ? (
          <p style={{ textAlign: "center", marginBottom: 24, fontWeight: 600, color: "var(--text-dim)" }}>
            {data.heading}
          </p>
        ) : null}
        <div className="logos">
          {(data.items ?? []).map((name, i) => (
            <span className="logo-pill" key={i}>
              {name}
            </span>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
