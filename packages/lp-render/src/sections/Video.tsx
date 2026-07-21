"use client";

import { useState } from "react";
import { useContent } from "../content";
import { FadeIn } from "../components/FadeIn";

// VSL / video block: a lightweight YouTube facade. Until the visitor clicks play we render
// only the poster thumbnail + a play button — the youtube-nocookie player (and its ~1 MB of
// JS + cookies) loads ONLY on click. That keeps mobile LCP fast on paid traffic and sets no
// YouTube cookies before the visitor chooses to watch (LGPD-friendly). We store only the
// video id, never raw iframe HTML — no dangerouslySetInnerHTML, no injection surface.
export function Video() {
  const { messages } = useContent();
  const data = messages.sections.video;
  const [playing, setPlaying] = useState(false);
  if (!data) return null;

  const id = data.youtubeId;
  const poster = data.poster ?? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  const embed = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&autoplay=1`;

  return (
    <section className="section section--dark section--center">
      <FadeIn className="container container--narrow">
        {data.eyebrow ? <span className="eyebrow">{data.eyebrow}</span> : null}
        <h2>{data.heading}</h2>
        {data.subhead ? <p className="lead">{data.subhead}</p> : null}
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            marginTop: "28px",
            borderRadius: "var(--radius-card)",
            overflow: "hidden",
            border: "1px solid var(--navy-border)",
            background: "#000",
            boxShadow: "0 24px 60px -20px rgba(0, 0, 0, 0.6)",
          }}
        >
          {playing ? (
            <iframe
              src={embed}
              title={data.heading}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label="Assistir ao vídeo"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
                padding: 0,
                cursor: "pointer",
                backgroundColor: "#000",
                backgroundImage: `url("${poster}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                boxShadow: "inset 0 0 0 2000px rgba(0, 0, 0, 0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "84px",
                  height: "84px",
                  borderRadius: "50%",
                  background: "var(--orange)",
                  boxShadow: "0 10px 30px -6px rgba(255, 107, 26, 0.7)",
                }}
              >
                <svg width="34" height="34" viewBox="0 0 34 34" fill="#ffffff">
                  <path d="M12 8 L27 17 L12 26 Z" />
                </svg>
              </span>
            </button>
          )}
        </div>
      </FadeIn>
    </section>
  );
}
