"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

export function Features({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.features;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container">
        <div className="section-head">
          <h2>{data.heading}</h2>
          {data.subhead ? <p>{data.subhead}</p> : null}
        </div>
        <div className="grid">
          {data.items.map((item, i) => (
            <div className="card" key={i}>
              {item.icon ? <div className="card-icon">{item.icon}</div> : null}
              <h3>{item.title}</h3>
              <p style={{ margin: 0 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
