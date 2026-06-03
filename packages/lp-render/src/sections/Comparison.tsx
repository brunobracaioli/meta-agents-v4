"use client";

import { useContent } from "../content";
import type { Tone, CompareCell } from "../content-types";
import { FadeIn } from "../components/FadeIn";

function Cell({ value, kind }: { value: CompareCell; kind: "ours" | "theirs" }) {
  if (typeof value === "string") {
    return <div className={kind}>{value}</div>;
  }
  return (
    <div className={kind}>
      {value ? <span className="yes">✓</span> : <span className="no">✗</span>}
    </div>
  );
}

export function Comparison({ tone }: { tone: Tone }) {
  const { messages } = useContent();
  const data = messages.sections.comparison;
  if (!data) return null;
  return (
    <section className={`section section--${tone}`}>
      <FadeIn className="container container--narrow">
        <div className="section-head">
          <h2>{data.heading}</h2>
          {data.subhead ? <p>{data.subhead}</p> : null}
        </div>
        <div className="compare">
          <div className="compare-row compare-head">
            <div />
            <div className="ours">{data.ours}</div>
            <div className="theirs">{data.theirs}</div>
          </div>
          {data.rows.map((row, i) => (
            <div className="compare-row" key={i}>
              <div>{row.label}</div>
              <Cell value={row.ours} kind="ours" />
              <Cell value={row.theirs} kind="theirs" />
            </div>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
