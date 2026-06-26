"use client";

// SPEC-019 Wave C.1 — creative panel (creative element). Shows the client's recent ad creatives
// the show_creative render-tool resolved: the selected creative big (image + headline + copy + CTA)
// with a thumbnail strip to switch between them (internal selection state, mirroring the folder
// shell). `data` is opaque on the transport, narrowed defensively.
import { useState } from "react";

type Creative = {
  id: string;
  headline: string | null;
  primary_text: string | null;
  call_to_action_type: string | null;
  image_url: string | null;
  link_url: string | null;
};

function isCreative(v: unknown): v is Creative {
  return !!v && typeof v === "object" && typeof (v as Record<string, unknown>).image_url === "string";
}

function extractCreatives(data: unknown): Creative[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>).creatives;
  return Array.isArray(raw) ? raw.filter(isCreative) : [];
}

export function CreativePanel({ data }: { data: unknown }) {
  const creatives = extractCreatives(data);
  const [selected, setSelected] = useState(0);

  if (creatives.length === 0) {
    return <p className="font-hud text-xs text-cyan-100/60">Nenhum criativo para mostrar.</p>;
  }
  const current = creatives[Math.min(selected, creatives.length - 1)]!;

  return (
    <div className="w-[min(88vw,420px)] space-y-3">
      <div className="hud-clip-sm overflow-hidden border border-cyan-300/20 bg-black/30">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote R2/Meta asset, not a static import */}
        <img
          src={current.image_url ?? ""}
          alt={current.headline ?? "criativo"}
          className="max-h-72 w-full object-contain"
          loading="lazy"
        />
      </div>

      {creatives.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {creatives.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(i)}
              aria-current={i === selected ? "true" : undefined}
              className={`hud-clip-sm h-11 w-11 shrink-0 overflow-hidden border transition ${
                i === selected ? "border-cyan-200/70 shadow-[0_0_12px_rgba(103,232,249,0.4)]" : "border-cyan-300/20 opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote asset thumbnail */}
              <img src={c.image_url ?? ""} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}

      {current.headline ? (
        <div className="font-hud text-sm text-cyan-50">{current.headline}</div>
      ) : null}
      {current.primary_text ? (
        <p className="line-clamp-3 font-hud text-xs leading-relaxed text-cyan-100/70">{current.primary_text}</p>
      ) : null}
      {current.call_to_action_type ? (
        <span className="hud-chip inline-block font-hud text-[0.6rem] uppercase tracking-[0.14em] text-cyan-200/80">
          {current.call_to_action_type}
        </span>
      ) : null}
    </div>
  );
}
