"use client";

// SPEC-019 Wave C (fix) — landing preview panel (landing element). Frames the SAME-ORIGIN draft
// preview route (/lp-preview/<id>) the show_landing tool resolved — the same surface the editor and
// live review embed. Framing same-origin keeps it inside the app CSP (frame-src 'self') and dodges
// the published page's own X-Frame-Options. We still validate `previewUrl` is exactly that route
// (defense in depth) before mounting, and only surface the public *.b2tech.io URL as an external
// link. `data` is opaque on the transport, narrowed below.
import { isB2TechUrl } from "@/lib/ultron/arc-url";

type LandingData = {
  name: string;
  previewUrl: string;
  url?: string | null;
  subdomain?: string | null;
  status?: string | null;
};

function isLandingData(data: unknown): data is LandingData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return typeof d.name === "string" && typeof d.previewUrl === "string";
}

// The iframe only ever loads our own draft preview route — never an attacker-supplied path/origin.
function isPreviewPath(path: string): boolean {
  return /^\/lp-preview\/[\w-]+(\?[\w=&-]*)?$/.test(path);
}

export function LandingPreviewPanel({ data }: { data: unknown }) {
  if (!isLandingData(data) || !isPreviewPath(data.previewUrl)) {
    return <p className="font-hud text-xs text-cyan-100/60">Sem preview de landing disponível.</p>;
  }
  const externalUrl = data.url && isB2TechUrl(data.url) ? data.url : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-hud text-[0.7rem] text-cyan-200/75 underline-offset-2 hover:underline"
          >
            {externalUrl.replace(/^https:\/\//, "")} ↗
          </a>
        ) : (
          <span className="truncate font-hud text-[0.7rem] text-cyan-100/55">{data.name}</span>
        )}
        {data.status ? (
          <span className="hud-chip shrink-0 font-hud text-[0.55rem] uppercase tracking-[0.12em] text-cyan-100/50">
            {data.status}
          </span>
        ) : null}
      </div>
      <div className="hud-clip-sm overflow-hidden border border-cyan-300/20 bg-black/40">
        <iframe
          src={data.previewUrl}
          title={`Preview: ${data.name}`}
          loading="lazy"
          className="h-[60vh] w-full bg-white"
        />
      </div>
    </div>
  );
}
