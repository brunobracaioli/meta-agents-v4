"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

export function Faq({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  if (!messages.faq || messages.faq.length === 0) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container container--narrow">
        <div className="section-head">
          <h2>Perguntas frequentes</h2>
        </div>
        {(messages.faq ?? []).map((item, i) => (
          <div className="faq-item" key={i}>
            <h3>{item.q}</h3>
            <p style={{ margin: 0 }}>{item.a}</p>
          </div>
        ))}
      </FadeIn>
    </section>
  );
}
