"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

// Dedicated risk-reversal block (e.g. 7-day money-back). See ADR 0013.
export function Guarantee({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.guarantee;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container">
        <div className="guarantee-box">
          <div className="guarantee-seal">{data.seal ?? "🛡️"}</div>
          <div>
            <h3 style={{ marginBottom: 6 }}>{data.heading}</h3>
            <p style={{ margin: 0 }}>{data.body}</p>
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
