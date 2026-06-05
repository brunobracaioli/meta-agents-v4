"use client";

import { useContent } from "../content";
import { FadeIn } from "../components/FadeIn";

// Instructor authority block: glass panel on a dark background. Photo is optional — when
// absent the layout collapses to a single centered column. Uses a plain <img> (static export
// has images.unoptimized). See ADR 0013.
export function Authority() {
  const { messages } = useContent();
  const data = messages.sections.authority;
  if (!data) return null;
  const hasImage = Boolean(data.image);
  return (
    <section className="section section--dark">
      <FadeIn className="container container--narrow">
        <div className={hasImage ? "authority" : "authority authority--solo"}>
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="authority-photo" src={data.image} alt={data.name} />
          ) : null}
          <div>
            {data.eyebrow ? <span className="eyebrow">{data.eyebrow}</span> : null}
            <h2 style={{ marginBottom: 8 }}>{data.name}</h2>
            <p>{data.bio}</p>
            {data.credentials && data.credentials.length > 0 ? (
              <div className="authority-creds">
                {(data.credentials ?? []).map((c, i) => (
                  <span className="cred" key={i}>
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
