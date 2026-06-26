"use client";

// SPEC-019 Wave C.1 — landing preview panel (landing element). Frames the live page the
// show_landing render-tool resolved. The server already restricts the URL to *.b2tech.io; we
// RE-VALIDATE here with the same shared guard before mounting the iframe (defense in depth,
// threat model §I) so a tampered payload can never embed an arbitrary origin. `data` is opaque
// on the transport, narrowed below.
import { isB2TechUrl } from "@/lib/ultron/arc-url";

type LandingData = { name: string; url: string; subdomain?: string | null; status?: string | null };

function isLandingData(data: unknown): data is LandingData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return typeof d.name === "string" && typeof d.url === "string";
}

export function LandingPreviewPanel({ data }: { data: unknown }) {
  if (!isLandingData(data) || !isB2TechUrl(data.url)) {
    return <p className="font-hud text-xs text-cyan-100/60">Sem preview de landing disponível.</p>;
  }
  return (
    <div className="w-[min(90vw,440px)] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-hud text-[0.7rem] text-cyan-200/75 underline-offset-2 hover:underline"
        >
          {data.url.replace(/^https:\/\//, "")}
        </a>
        {data.status ? (
          <span className="hud-chip shrink-0 font-hud text-[0.55rem] uppercase tracking-[0.12em] text-cyan-100/50">
            {data.status}
          </span>
        ) : null}
      </div>
      <div className="hud-clip-sm overflow-hidden border border-cyan-300/20 bg-black/40">
        <iframe
          src={data.url}
          title={`Preview: ${data.name}`}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-[60vh] w-full"
        />
      </div>
    </div>
  );
}
