"use client";

import { useContent } from "../content";
import { FadeIn } from "../components/FadeIn";

// Certification authority block — claude-code.b2tech.io ccaf-section parity, on a dark band
// directly under the instructor (Authority). Left: the certificate (clickable when verifyUrl
// is set). Right: scarcity stat + lead + verify CTA. Below: an exam-facts grid and weighted
// domain bars. Everything but the heading is optional, so a partial draft never crashes.
export function Ccaf() {
  const { messages } = useContent();
  const data = messages.sections.ccaf;
  if (!data) return null;

  const facts = data.examFacts ?? [];
  const domains = data.domains ?? [];
  const verifyUrl = data.verifyUrl;
  const verifyLabel = data.verifyLabel ?? "Verificar certificado";

  const cert = data.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ccaf-cert-img" src={data.image} alt={data.heading} />
  ) : null;

  return (
    <section id="ccaf" className="section section--dark">
      <FadeIn className="container">
        <div className="section-head">
          {data.eyebrow ? <span className="eyebrow eyebrow--tick">{data.eyebrow}</span> : null}
          <h2>{data.heading}</h2>
          {data.subhead ? <p>{data.subhead}</p> : null}
        </div>

        <div className="ccaf">
          {cert ? (
            verifyUrl ? (
              <a
                className="ccaf-cert ccaf-cert--link"
                href={verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={verifyLabel}
              >
                {cert}
              </a>
            ) : (
              <div className="ccaf-cert">{cert}</div>
            )
          ) : null}

          <div className="ccaf-info">
            {data.badge ? <span className="badge">{data.badge}</span> : null}

            {data.scarcityNumber ? (
              <div className="ccaf-scarcity">
                <span className="ccaf-scarcity-number gradient-text">{data.scarcityNumber}</span>
                {data.scarcityLabel ? (
                  <span className="ccaf-scarcity-label">{data.scarcityLabel}</span>
                ) : null}
              </div>
            ) : null}

            {data.scarcityLine ? <p className="ccaf-line">{data.scarcityLine}</p> : null}
            {data.lead ? <p>{data.lead}</p> : null}

            {verifyUrl ? (
              <a
                className="ccaf-verify"
                href={verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-cta="ccaf_verify"
              >
                {verifyLabel}
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            {verifyUrl && data.verifyHint ? (
              <p className="ccaf-verify-hint">{data.verifyHint}</p>
            ) : null}
          </div>
        </div>

        {facts.length > 0 || domains.length > 0 ? (
          <div className="ccaf-exam">
            {data.examTitle ? <h3>{data.examTitle}</h3> : null}
            {data.examNote ? <p className="ccaf-exam-note">{data.examNote}</p> : null}

            {facts.length > 0 ? (
              <div className="ccaf-facts">
                {facts.map((f, i) => (
                  <div className="ccaf-fact" key={i}>
                    <p className="ccaf-fact-title">{f.title}</p>
                    <p className="ccaf-fact-desc">{f.description}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {domains.length > 0 ? (
              <>
                <div className="ccaf-domains-head">
                  {data.domainsTitle ? <h4>{data.domainsTitle}</h4> : null}
                  {data.domainsSubtitle ? (
                    <span className="ccaf-domains-sub">{data.domainsSubtitle}</span>
                  ) : null}
                </div>
                <div className="ccaf-domains">
                  {domains.map((d, i) => (
                    <div className="ccaf-domain" key={i}>
                      <div className="ccaf-domain-row">
                        <span>{d.label}</span>
                        <span className="ccaf-domain-weight">{d.weight}%</span>
                      </div>
                      <div className="ccaf-bar">
                        <div className="ccaf-bar-fill" style={{ width: `${d.weight}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </FadeIn>
    </section>
  );
}
