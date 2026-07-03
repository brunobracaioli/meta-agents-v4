"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  NODE_REGISTRY,
  OUTPUT_HANDLE,
  defaultConfig,
  nodeDef,
  type NodeKind,
  type NodeType,
} from "@/lib/flows/node-registry";
import { effectiveOutputType, validateGraph } from "@/lib/flows/graph-validate";
import type { FlowGraph } from "@/lib/flows/validate";
import { FlowNodeCard, type FlowNodeType } from "@/components/flows/flow-node";
import { NodeConfigPanel, type FlowAssetView } from "@/components/flows/node-config-panel";

// SPEC-020 §6.2 (Wave 1) — the canvas editor: palette → typed connections → config panel →
// debounced autosave with optimistic version. The Run button stays disabled until the engine
// lands (Wave 2); the issue list it would gate on is live already (shared graph-validate).

type FlowProp = {
  id: string;
  name: string;
  status: string;
  version: number;
  graph: FlowGraph;
  clientName: string | null;
};

type SaveState = "saved" | "pending" | "saving" | "conflict" | "error";

const AUTOSAVE_DEBOUNCE_MS = 2000;

const nodeTypes = { flowNode: FlowNodeCard };

const KIND_LABELS: Record<NodeKind, string> = { trigger: "Triggers", action: "Ações", gate: "Gates" };

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function toRfNodes(graph: FlowGraph): FlowNodeType[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: "flowNode" as const,
    position: n.position,
    data: { nodeType: n.type, config: n.config, hasIssue: false },
  }));
}

function toRfEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
  }));
}

/** Persisted shape: strips every React Flow runtime field (selected, measured, …). */
function toGraph(nodes: FlowNodeType[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: n.data.config,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? OUTPUT_HANDLE,
      target: e.target,
      targetHandle: e.targetHandle ?? "",
    })),
  };
}

/** true when `to` is reachable from `from` — used to refuse cycle-closing connections. */
function reaches(from: string, to: string, edges: Edge[]): boolean {
  const queue = [from];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  return false;
}

function stripUndefined(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined));
}

export function FlowEditor({ flow, initialAssets }: { flow: FlowProp; initialAssets: FlowAssetView[] }) {
  const [nodes, setNodes] = useState<FlowNodeType[]>(() => toRfNodes(flow.graph));
  const [edges, setEdges] = useState<Edge[]>(() => toRfEdges(flow.graph));
  const [name, setName] = useState(flow.name);
  const [assets, setAssets] = useState<FlowAssetView[]>(initialAssets);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);

  const versionRef = useRef(flow.version);
  const latestSnapshotRef = useRef<string>("");
  const savingRef = useRef(false);
  const skipFirstSaveRef = useRef(true);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const graphJson = useMemo(() => JSON.stringify(graph), [graph]);
  const issues = useMemo(() => validateGraph(graph), [graph]);
  const issueNodeIds = useMemo(() => new Set(issues.map((i) => i.nodeId).filter(Boolean)), [issues]);

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, hasIssue: issueNodeIds.has(n.id) } })),
    [nodes, issueNodeIds],
  );

  const selectedNode = nodes.find((n) => n.selected);

  // ---------- autosave (debounce + optimistic version; SPEC-020 §8.13) ----------

  const save = useCallback(
    async (snapshot: { graphJson: string; name: string }) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/flows/${flow.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: versionRef.current,
            name: snapshot.name,
            graph: JSON.parse(snapshot.graphJson) as FlowGraph,
          }),
        });
        if (res.status === 409) {
          const body = (await res.json()) as { current?: { version: number; name: string; graph: FlowGraph } };
          if (body.current) {
            // Another tab won the race: adopt its state instead of corrupting the graph.
            versionRef.current = body.current.version;
            setName(body.current.name);
            setNodes(toRfNodes(body.current.graph));
            setEdges(toRfEdges(body.current.graph));
            skipFirstSaveRef.current = true;
          }
          setSaveState("conflict");
          setSaveError("Este flow foi editado em outra aba — recarregamos a versão mais recente.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { issues?: { message: string }[] } | null;
          setSaveState("error");
          setSaveError(body?.issues?.[0]?.message ?? "Falha ao salvar. Vamos tentar de novo na próxima edição.");
          return;
        }
        const body = (await res.json()) as { version: number };
        versionRef.current = body.version;
        setSaveError(null);
        // Only report "saved" if nothing changed while the request was in flight.
        const latest = latestSnapshotRef.current;
        setSaveState(latest === snapshot.graphJson + snapshot.name ? "saved" : "pending");
      } catch {
        setSaveState("error");
        setSaveError("Sem conexão — as edições continuam locais até salvar.");
      } finally {
        savingRef.current = false;
      }
    },
    [flow.id],
  );

  useEffect(() => {
    latestSnapshotRef.current = graphJson + name;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    setSaveState((s) => (s === "saving" ? s : "pending"));
    const t = setTimeout(() => void save({ graphJson, name }), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [graphJson, name, save]);

  // ---------- graph interactions ----------

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNodeType>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const isValidConnection: IsValidConnection = useCallback(
    (conn) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return false;
      const targetNode = nodes.find((n) => n.id === conn.target);
      const def = targetNode ? nodeDef(targetNode.data.nodeType) : null;
      const port = def?.inputPorts.find((p) => p.key === conn.targetHandle);
      if (!def || !port) return false;
      if (edges.some((e) => e.target === conn.target && e.targetHandle === conn.targetHandle)) return false;
      if (reaches(conn.target, conn.source, edges)) return false; // would close a cycle
      const sourceType = effectiveOutputType(conn.source, toGraph(nodes, edges));
      return sourceType ? port.accepts.includes(sourceType) : true;
    },
    [nodes, edges],
  );

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => addEdge({ ...conn, id: randomId("e"), sourceHandle: conn.sourceHandle ?? OUTPUT_HANDLE }, eds));
  }, []);

  const addNode = useCallback((type: NodeType) => {
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      {
        id: randomId("n"),
        type: "flowNode" as const,
        position: { x: 120 + (nds.length % 5) * 60, y: 120 + (nds.length % 5) * 60 },
        selected: true,
        data: { nodeType: type, config: defaultConfig(type), hasIssue: false },
      },
    ]);
  }, []);

  const updateConfig = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, config: stripUndefined({ ...n.data.config, ...patch }) } } : n,
      ),
    );
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, []);

  const selectNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === nodeId })));
  }, []);

  // ---------- reference assets ----------

  const uploadAsset = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/flows/${flow.id}/assets`, { method: "POST", body: form });
      if (!res.ok) throw new Error("upload_failed");
      const asset = (await res.json()) as FlowAssetView;
      setAssets((a) => [asset, ...a]);
    },
    [flow.id],
  );

  const deleteAsset = useCallback(
    async (assetId: string) => {
      await fetch(`/api/flows/${flow.id}/assets/${assetId}`, { method: "DELETE" }).catch(() => undefined);
      setAssets((a) => a.filter((x) => x.id !== assetId));
      // Unselect the removed reference wherever a node config still points at it.
      setNodes((nds) =>
        nds.map((n) => {
          const refs = n.data.config.referenceAssetIds;
          if (!Array.isArray(refs) || !refs.includes(assetId)) return n;
          return {
            ...n,
            data: { ...n.data, config: { ...n.data.config, referenceAssetIds: refs.filter((r) => r !== assetId) } },
          };
        }),
      );
    },
    [flow.id],
  );

  // ---------- render ----------

  const paletteByKind: [NodeKind, NodeType[]][] = useMemo(() => {
    const groups: Record<NodeKind, NodeType[]> = { trigger: [], action: [], gate: [] };
    for (const def of Object.values(NODE_REGISTRY)) groups[def.kind].push(def.type);
    return (Object.entries(groups) as [NodeKind, NodeType[]][]).filter(([, types]) => types.length > 0);
  }, []);

  const saveBadge: Record<SaveState, { label: string; className: string }> = {
    saved: { label: "salvo", className: "border-emerald-300/25 text-emerald-200/80" },
    pending: { label: "editando…", className: "border-white/15 text-white/50" },
    saving: { label: "salvando…", className: "border-cyan-300/25 text-cyan-200/80" },
    conflict: { label: "conflito", className: "border-amber-300/30 text-amber-200" },
    error: { label: "erro ao salvar", className: "border-rose-300/30 text-rose-200" },
  };

  return (
    <div className="flex h-[calc(100vh-160px)] min-h-[540px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard/flows" className="text-sm text-white/45 transition hover:text-white">
          ← Flows
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-white outline-none transition focus:border-cyan-300/30 focus:bg-white/[0.03]"
        />
        {flow.clientName ? <span className="text-xs text-white/40">{flow.clientName}</span> : null}
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${saveBadge[saveState].className}`}
        >
          {saveBadge[saveState].label}
        </span>
        <button
          type="button"
          disabled
          title="Execução chega na Wave 2 — o motor de runs ainda não está ativo"
          className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/35"
        >
          Run {issues.length > 0 ? `(${issues.length} pendência${issues.length === 1 ? "" : "s"})` : ""}
        </button>
      </div>
      {saveError ? <p className="text-xs text-amber-200/90">{saveError}</p> : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="tech-panel flex w-48 shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border border-white/8 p-3">
          {paletteByKind.map(([kind, types]) => (
            <div key={kind}>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">{KIND_LABELS[kind]}</p>
              <div className="mt-2 space-y-1.5">
                {types.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addNode(type)}
                    className="w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left text-xs text-white/75 transition hover:border-cyan-300/30 hover:text-white"
                  >
                    + {NODE_REGISTRY[type].label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {issues.length > 0 ? (
            <div className="mt-auto border-t border-white/8 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-200/70">
                Pendências ({issues.length})
              </p>
              <ul className="mt-2 space-y-1.5">
                {issues.slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => issue.nodeId && selectNode(issue.nodeId)}
                      className="w-full text-left text-[11px] leading-snug text-amber-200/75 transition hover:text-amber-100"
                    >
                      · {issue.message}
                    </button>
                  </li>
                ))}
                {issues.length > 8 ? <li className="text-[11px] text-white/35">… e mais {issues.length - 8}</li> : null}
              </ul>
            </div>
          ) : (
            <p className="mt-auto border-t border-white/8 pt-3 text-[11px] text-emerald-200/60">
              Grafo válido — pronto pro Run (Wave 2).
            </p>
          )}
        </aside>

        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-white/8 bg-[#060a16]">
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            colorMode="dark"
            fitView
            minZoom={0.3}
            maxZoom={1.6}
            defaultEdgeOptions={{ style: { stroke: "rgba(103, 232, 249, 0.45)", strokeWidth: 1.5 } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(148, 163, 184, 0.18)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {selectedNode ? (
          <NodeConfigPanel
            key={selectedNode.id}
            nodeId={selectedNode.id}
            nodeType={selectedNode.data.nodeType}
            config={selectedNode.data.config}
            assets={assets}
            onConfigChange={(patch) => updateConfig(selectedNode.id, patch)}
            onDeleteNode={() => deleteNode(selectedNode.id)}
            onUploadAsset={uploadAsset}
            onDeleteAsset={deleteAsset}
          />
        ) : null}
      </div>
    </div>
  );
}
