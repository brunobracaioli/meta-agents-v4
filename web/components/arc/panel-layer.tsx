"use client";

// SPEC-019 — renders the active-panel stack from the Render Bus. `renderBody` switches on
// `panel.element`: Wave A ships the funnel and daily-summary panels; the remaining elements
// (clients, client, analyses, creative, landing) still fall through to the generic JSON body
// until their waves land.
import { AnimatePresence } from "framer-motion";
import { useRenderBus } from "./use-render-bus";
import { HoloPanel } from "./holo-panel";
import { FunnelPanel } from "./panels/funnel-panel";
import { DailySummaryPanel } from "./panels/daily-summary-panel";
import { ClientsFolderPanel } from "./panels/clients-folder";
import { ClientCardPanel } from "./panels/client-card";
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

export function PanelLayer() {
  const { panels, focusId, dispatch } = useRenderBus();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-wrap content-center items-center justify-center gap-6 p-6">
      <AnimatePresence>
        {panels.map((panel) => (
          <HoloPanel
            key={panel.id}
            title={ELEMENT_TITLES[panel.element]}
            anchor={panel.anchor}
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
