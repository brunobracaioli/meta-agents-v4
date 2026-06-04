"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

export function Solution({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.solution;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container container--narrow">
        <span className="eyebrow">A solução</span>
        <h2>{data.heading}</h2>
        <p className="lead">{data.body}</p>
        {data.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="section-image" src={data.image} alt="" />
        ) : null}
      </FadeIn>
    </section>
  );
}
