"use client";

// SPEC-019 Wave C.1 — analyses panel (analyses element). Renders the latest performance analysis
// the show_analyses render-tool resolved: overall verdict, summary, and the diagnostic findings
// (severity + recommended action). `data` is opaque on the transport, so every field is narrowed
// defensively and a bad shape degrades to a notice instead of crashing the stage.

type Finding = {
  severity: string | number | null;
  metric_focus: string | null;
  diagnosis: string | null;
  recommended_action: string | null;
  entity_name: string | null;
};
type AnalysisData = {
  client_name?: string;
  analysis: { overall_verdict: string | null; summary: string | null; objective: string | null; created_at: string };
  findings: Finding[];
};

function isAnalysisData(data: unknown): data is AnalysisData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return !!d.analysis && typeof d.analysis === "object";
}

const VERDICT_TONE: Record<string, string> = {
  healthy: "text-emerald-200/90 border-emerald-300/40",
  good: "text-emerald-200/90 border-emerald-300/40",
  warning: "text-amber-200/90 border-amber-300/40",
  attention: "text-amber-200/90 border-amber-300/40",
  critical: "text-rose-200/90 border-rose-300/40",
  bad: "text-rose-200/90 border-rose-300/40",
};

function verdictTone(verdict: string | null): string {
  return (verdict && VERDICT_TONE[verdict.toLowerCase()]) || "text-cyan-100/80 border-cyan-300/30";
}

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

export function AnalysesPanel({ data }: { data: unknown }) {
  if (!isAnalysisData(data)) {
    return <p className="font-hud text-xs text-cyan-100/60">Sem análise para mostrar.</p>;
  }
  const { analysis } = data;
  const findings = Array.isArray(data.findings) ? data.findings : [];

  return (
    <div className="w-[min(88vw,440px)] space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-cyan-300/15 pb-2.5">
        <span
          className={`hud-clip-sm border px-2 py-1 font-hud text-[0.65rem] uppercase tracking-[0.16em] ${verdictTone(
            analysis.overall_verdict,
          )}`}
        >
          {analysis.overall_verdict ?? "—"}
        </span>
        <span className="font-hud text-[0.65rem] uppercase tracking-[0.14em] text-cyan-100/40">
          {data.client_name ?? ""} · {fmtDate(analysis.created_at)}
        </span>
      </div>

      {analysis.summary ? (
        <p className="font-hud text-xs leading-relaxed text-cyan-100/75">{analysis.summary}</p>
      ) : null}

      {findings.length === 0 ? (
        <p className="font-hud text-xs text-cyan-100/45">Sem diagnósticos registrados.</p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-auto pr-1">
          {findings.slice(0, 8).map((f, i) => (
            <li key={i} className="border-l-2 border-cyan-300/25 pl-2.5">
              <div className="flex items-center gap-2">
                <span className="font-hud text-[0.6rem] uppercase tracking-[0.12em] text-cyan-200/70">
                  {String(f.severity ?? "—")}
                </span>
                {f.entity_name ? (
                  <span className="truncate font-hud text-[0.6rem] text-cyan-100/45">{f.entity_name}</span>
                ) : null}
              </div>
              {f.diagnosis ? (
                <p className="font-hud text-xs leading-snug text-cyan-100/75">{f.diagnosis}</p>
              ) : null}
              {f.recommended_action ? (
                <p className="font-hud text-[0.7rem] leading-snug text-cyan-200/60">→ {f.recommended_action}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
