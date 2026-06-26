"use client";

// SPEC-019 — renders the active-panel stack from the Render Bus. `renderBody` switches on
// `panel.element`: every element now has a dedicated panel (Waves A/B/C.1); anything unmapped
// still falls through to the generic JSON body.
import { AnimatePresence } from "framer-motion";
import { useRenderBus } from "./use-render-bus";
import { HoloPanel } from "./holo-panel";
import { FunnelPanel } from "./panels/funnel-panel";
import { DailySummaryPanel } from "./panels/daily-summary-panel";
import { ClientsFolderPanel } from "./panels/clients-folder";
import { ClientCardPanel } from "./panels/client-card";
import { AnalysesPanel } from "./panels/analyses-panel";
import { CreativePanel } from "./panels/creative-panel";
import { LandingPreviewPanel } from "./panels/landing-preview-panel";
import { type PanelSize } from "./holo-panel";
import { type Panel } from "@/lib/ultron/render-bus-reducer";

const ELEMENT_TITLES: Record<Panel["element"], string> = {
  funnel: "Funil",
  daily_summary: "Resumo do dia",
  clients: "Clientes",
  client: "Cliente",
  analyses: "Análises",
  creative: "Criativo",
  landing: "Landing page",
};

// Content-heavy panels get the wide frame; compact readouts stay default.
const ELEMENT_SIZE: Partial<Record<Panel["element"], PanelSize>> = {
  landing: "wide",
  creative: "wide",
  analyses: "wide",
};

export function PanelLayer() {
  const { panels, focusId, dispatch } = useRenderBus();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-wrap content-center items-center justify-center gap-6 overflow-y-auto p-6">
      <AnimatePresence>
        {panels.map((panel) => (
          <HoloPanel
            key={panel.id}
            title={ELEMENT_TITLES[panel.element]}
            anchor={panel.anchor}
            size={ELEMENT_SIZE[panel.element] ?? "default"}
            focused={panel.id === focusId}
            onDismiss={() => dispatch({ op: "dismiss", target: panel.id })}
          >
            {renderBody(panel)}
          </HoloPanel>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Per-element body. Elements without a dedicated panel yet fall through to the generic JSON.
function renderBody(panel: Panel) {
  switch (panel.element) {
    case "funnel":
      return <FunnelPanel data={panel.data} />;
    case "daily_summary":
      return <DailySummaryPanel data={panel.data} />;
    case "clients":
      return <ClientsFolderPanel data={panel.data} />;
    case "client":
      return <ClientCardPanel data={panel.data} />;
    case "analyses":
      return <AnalysesPanel data={panel.data} />;
    case "creative":
      return <CreativePanel data={panel.data} />;
    case "landing":
      return <LandingPreviewPanel data={panel.data} />;
    default:
      return (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-hud text-xs leading-relaxed text-cyan-100/70">
          {safeStringify(panel.data)}
        </pre>
      );
  }
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2) ?? String(data);
  } catch {
    return String(data);
  }
}
