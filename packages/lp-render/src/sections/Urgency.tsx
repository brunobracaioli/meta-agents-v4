"use client";

import { useEffect, useState } from "react";
import { useContent } from "../content";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Urgency bar with an optional live countdown to a FIXED ISO deadline (content-spec.deadline).
// The countdown is client-only: SSR/first render shows just the label + scarcity (no time),
// so there's no hydration mismatch. If the deadline is missing or already past, the timer is
// omitted. See ADR 0013 / SPEC-011.
export function Urgency() {
  const { messages, contentSpec } = useContent();
  const data = messages.sections.urgency;
  const deadline = contentSpec.deadline;
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) return;
    const target = Date.parse(deadline);
    if (Number.isNaN(target)) return;
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!data) return null;

  const showCountdown = left !== null && left > 0;
  const total = showCountdown ? Math.floor((left as number) / 1000) : 0;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return (
    <section className="urgency">
      <div className="urgency-inner">
        <span>{data.label}</span>
        {showCountdown ? (
          <span className="countdown">
            {days > 0 ? (
              <span className="count-cell">
                {pad(days)}
                <span>dias</span>
              </span>
            ) : null}
            <span className="count-cell">
              {pad(hours)}
              <span>hrs</span>
            </span>
            <span className="count-cell">
              {pad(minutes)}
              <span>min</span>
            </span>
            <span className="count-cell">
              {pad(seconds)}
              <span>seg</span>
            </span>
          </span>
        ) : null}
        {data.scarcity ? <span>{data.scarcity}</span> : null}
      </div>
    </section>
  );
}
