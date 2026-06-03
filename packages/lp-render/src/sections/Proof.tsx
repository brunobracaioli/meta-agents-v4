"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { Marquee } from "../components/Marquee";

export function Proof({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.proof;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <div className="section-head">
        <h2>{data.heading}</h2>
        {data.subhead ? <p>{data.subhead}</p> : null}
      </div>
      <Marquee>
        {data.testimonials.map((t, i) => (
          <div className="card" key={i}>
            <p style={{ color: "var(--text)" }}>“{t.quote}”</p>
            <p className="eyebrow" style={{ marginTop: 12, marginBottom: 0 }}>
              {t.author}
            </p>
          </div>
        ))}
      </Marquee>
    </section>
  );
}
