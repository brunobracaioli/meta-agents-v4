"use client";

import { useContent } from "../content";
import type { Tone } from "../content-types";
import { FadeIn } from "../components/FadeIn";

export function Problem({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.problem;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container container--narrow">
        <h2>{data.heading}</h2>
        <p className="lead">{data.body}</p>
        {data.bullets ? (
          <ul className="bullets bullets--arrow">
            {data.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
        {data.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="section-image" src={data.image} alt="" />
        ) : null}
      </FadeIn>
    </section>
  );
}
