"use client";

import { useContent } from "../content";
import { FadeIn } from "../components/FadeIn";

// Instructor authority block — claude-code.b2tech.io instructor-section parity. A big centered
// section header (eyebrow + title) sits above an open, wide photo+bio grid (NOT a glass card):
// a gradient-framed square photo on the left, the name/role/bio/quote/credentials/products on
// the right. Photo is optional — without it the layout collapses to a single centered column.
// Plain <img> (static export → images.unoptimized). See ADR 0013.
export function Authority() {
  const { messages } = useContent();
  const data = messages.sections.authority;
  if (!data) return null;
  const hasImage = Boolean(data.image);
  const products = data.products ?? [];
  return (
    <section className="section section--dark">
      <FadeIn className="container">
        {data.title || data.eyebrow ? (
          <div className="section-head">
            {data.eyebrow ? <span className="eyebrow eyebrow--tick">{data.eyebrow}</span> : null}
            {data.title ? <h2>{data.title}</h2> : null}
          </div>
        ) : null}

        <div className={hasImage ? "authority" : "authority authority--solo"}>
          {hasImage ? (
            <div className="authority-photo-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="authority-photo" src={data.image} alt={data.name} />
            </div>
          ) : null}
          <div className="authority-body">
            <h3 className="authority-name">{data.name}</h3>
            {data.role ? <p className="authority-role">{data.role}</p> : null}
            <p>{data.bio}</p>
            {data.quote ? <blockquote className="authority-quote">{data.quote}</blockquote> : null}
            {data.credentials && data.credentials.length > 0 ? (
              <div className="authority-creds">
                {(data.credentials ?? []).map((c, i) => (
                  <span className="cred" key={i}>
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {products.length > 0 ? (
              <div className="authority-products">
                {data.productsLabel ? (
                  <p className="authority-products-label">{data.productsLabel}</p>
                ) : null}
                <div className="authority-products-list">
                  {products.map((p, i) => (
                    <span className="prod" key={i}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
