"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

export function Curriculum({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.curriculum;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container">
        <div className="section-head">
          <h2>{data.heading}</h2>
          {data.subhead ? <p>{data.subhead}</p> : null}
        </div>
        <div className="grid">
          {(data.modules ?? []).map((m, i) => (
            <div className="card" key={i}>
              <span className="eyebrow">Módulo {i + 1}</span>
              <h3>{m.title}</h3>
              <p style={{ margin: 0 }}>{m.desc}</p>
            </div>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
