"use client";

import { useContent } from "../content";
import { FadeIn } from "../components/FadeIn";

// Dark numbers band — acts as a visual break between light sections. See ADR 0013.
export function Stats() {
  const { messages } = useContent();
  const data = messages.sections.stats;
  if (!data) return null;
  return (
    <section className="section section--dark">
      <FadeIn className="container">
        {data.heading ? (
          <div className="section-head">
            <h2>{data.heading}</h2>
          </div>
        ) : null}
        <div className="stats">
          {(data.items ?? []).map((item, i) => (
            <div key={i}>
              <div className="stat-value">{item.value}</div>
              <div className="stat-label">{item.label}</div>
            </div>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
