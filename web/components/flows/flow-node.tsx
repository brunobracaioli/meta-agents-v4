"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { OUTPUT_HANDLE, nodeDef, type NodeType } from "@/lib/flows/node-registry";

export type FlowNodeData = {
  nodeType: NodeType;
  config: Record<string, unknown>;
  /** true when validateGraph reports at least one issue anchored on this node. */
  hasIssue: boolean;
};

export type FlowNodeType = Node<FlowNodeData, "flowNode">;

const KIND_BADGE: Record<string, string> = {
  action: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200/80",
  gate: "border-violet-300/25 bg-violet-400/10 text-violet-200/80",
  trigger: "border-amber-300/25 bg-amber-400/10 text-amber-200/80",
};

function summary(type: NodeType, config: Record<string, unknown>): string {
  switch (type) {
    case "scrape": {
      const url = typeof config.url === "string" ? config.url : "";
      try {
        return url ? new URL(url).hostname : "defina a URL";
      } catch {
        return url || "defina a URL";
      }
    }
    case "copy":
      return `3 variações · ${String(config.objective ?? "objetivo?")} · ${String(config.language ?? "pt-BR")}`;
    case "image_creative": {
      const refs = Array.isArray(config.referenceAssetIds) ? config.referenceAssetIds.length : 0;
      return `${String(config.aspect ?? "1:1")} · ${refs} referência${refs === 1 ? "" : "s"}`;
    }
    case "approval":
      return config.notifyTelegram === false ? "sem notificação" : "notifica no Telegram";
    case "meta_campaign": {
      const cents = typeof config.dailyBudgetCents === "number" ? config.dailyBudgetCents : null;
      const budget = cents ? `R$ ${(cents / 100).toFixed(2)}/dia` : "defina o orçamento";
      return `${String(config.campaignType ?? "tipo?")} · ${budget} · PAUSED`;
    }
  }
}

export function FlowNodeCard({ data, selected }: NodeProps<FlowNodeType>) {
  const def = nodeDef(data.nodeType);
  if (!def) return null;

  return (
    <div
      className={`w-56 rounded-lg border bg-[#0a0f1e]/95 p-3 shadow-lg transition ${
        selected
          ? "border-cyan-300/60 shadow-cyan-400/10"
          : data.hasIssue
            ? "border-amber-300/40"
            : "border-white/12"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-white/90">{def.label}</span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
            KIND_BADGE[def.kind] ?? KIND_BADGE.action
          }`}
        >
          {def.kind}
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] text-white/40">{summary(data.nodeType, data.config)}</p>
      {data.hasIssue ? <p className="mt-1 text-[10px] text-amber-300/80">config incompleto</p> : null}

      {def.inputPorts.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-white/8 pt-2">
          {def.inputPorts.map((port) => (
            <div key={port.key} className="relative text-[10px] text-white/45">
              <Handle
                id={port.key}
                type="target"
                position={Position.Left}
                className="!h-2.5 !w-2.5 !border !border-cyan-200/60 !bg-[#0a0f1e]"
                style={{ left: -18, top: "50%" }}
              />
              {port.label}
              {port.required ? <span className="text-amber-300/70"> *</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <Handle
        id={OUTPUT_HANDLE}
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border !border-orange-300/70 !bg-[#0a0f1e]"
      />
    </div>
  );
}
