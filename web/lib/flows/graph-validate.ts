import type { FlowGraph, FlowGraphEdge, FlowGraphNode } from "@/lib/flows/validate";
import {
  MAX_GRAPH_NODES,
  NODE_REGISTRY,
  OUTPUT_HANDLE,
  isSafePublicHttpsUrl,
  nodeDef,
  type PayloadType,
} from "@/lib/flows/node-registry";

// SPEC-020 §2.2 / §6.2 — pure graph validation shared verbatim by the editor (Run button +
// issue list) and the server (Wave 2 gates POST /run on the same module). No I/O, no React.

export type GraphIssue = {
  code:
    | "duplicate_node_id"
    | "unknown_node_type"
    | "edge_endpoint_missing"
    | "unknown_port"
    | "port_already_connected"
    | "type_mismatch"
    | "cycle"
    | "required_port_unconnected"
    | "image_creative_no_input"
    | "invalid_config"
    | "unsafe_url"
    | "no_executable_node"
    | "too_many_nodes";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

type Indexed = {
  nodesById: Map<string, FlowGraphNode>;
  incomingByNode: Map<string, FlowGraphEdge[]>;
};

function indexGraph(graph: FlowGraph): Indexed {
  const nodesById = new Map<string, FlowGraphNode>();
  for (const n of graph.nodes) nodesById.set(n.id, n);
  const incomingByNode = new Map<string, FlowGraphEdge[]>();
  for (const e of graph.edges) {
    const list = incomingByNode.get(e.target) ?? [];
    list.push(e);
    incomingByNode.set(e.target, list);
  }
  return { nodesById, incomingByNode };
}

/** Effective payload type a node emits: gates with passthrough forward their (single) input's
 * effective type; unwired gates fall back to their declared outputType. Cycle-safe. */
export function effectiveOutputType(
  nodeId: string,
  graph: FlowGraph,
  seen: Set<string> = new Set(),
): PayloadType | null {
  if (seen.has(nodeId)) return null; // cycle — reported separately
  seen.add(nodeId);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const def = nodeDef(node.type);
  if (!def) return null;
  if (!def.passthrough) return def.outputType;
  const inbound = graph.edges.find((e) => e.target === nodeId);
  if (!inbound) return def.outputType;
  return effectiveOutputType(inbound.source, graph, seen);
}

/** Kahn — returns the ids of nodes stuck in a cycle (empty array = DAG). */
function findCycleNodes(graph: FlowGraph): string[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of graph.nodes) indegree.set(n.id, 0);
  for (const e of graph.edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    const out = adjacency.get(e.source) ?? [];
    out.push(e.target);
    adjacency.set(e.source, out);
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (visited === graph.nodes.length) return [];
  return [...indegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
}

/** Hard-block subset used by PATCH save (criterion §8.8): a PRESENT, well-formed URL pointing
 * at a private/unsafe host is rejected at save time — an incomplete config is not. */
export function findUnsafeUrls(graph: FlowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const node of graph.nodes) {
    for (const key of ["url", "linkUrl"]) {
      const value = (node.config as Record<string, unknown>)[key];
      if (typeof value !== "string" || value.trim() === "") continue;
      let parsable = true;
      try {
        new URL(value);
      } catch {
        parsable = false; // still typing — the config check reports it, save accepts it
      }
      if (parsable && !isSafePublicHttpsUrl(value)) {
        issues.push({
          code: "unsafe_url",
          nodeId: node.id,
          message: `${NODE_REGISTRY[node.type].label}: URL precisa ser https pública (sem IP, localhost ou porta não-padrão)`,
        });
      }
    }
  }
  return issues;
}

/** Full validation — the Run gate. Returns [] when the graph is runnable. */
export function validateGraph(graph: FlowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const { nodesById, incomingByNode } = indexGraph(graph);

  if (graph.nodes.length > MAX_GRAPH_NODES) {
    issues.push({ code: "too_many_nodes", message: `Máximo de ${MAX_GRAPH_NODES} nodes por flow` });
  }

  const seenIds = new Set<string>();
  for (const node of graph.nodes) {
    if (seenIds.has(node.id)) {
      issues.push({ code: "duplicate_node_id", nodeId: node.id, message: `Node id duplicado: ${node.id}` });
    }
    seenIds.add(node.id);
    if (!nodeDef(node.type)) {
      issues.push({ code: "unknown_node_type", nodeId: node.id, message: `Tipo de node desconhecido: ${node.type}` });
    }
  }

  // Edges: endpoints, ports, single connection per input port, payload-type compatibility.
  const usedPorts = new Set<string>();
  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      issues.push({ code: "edge_endpoint_missing", edgeId: edge.id, message: "Conexão aponta para node inexistente" });
      continue;
    }
    const targetDef = nodeDef(target.type);
    if (!targetDef) continue;
    if (edge.sourceHandle !== OUTPUT_HANDLE) {
      issues.push({ code: "unknown_port", edgeId: edge.id, nodeId: source.id, message: `Porta de saída desconhecida: ${edge.sourceHandle}` });
      continue;
    }
    const port = targetDef.inputPorts.find((p) => p.key === edge.targetHandle);
    if (!port) {
      issues.push({
        code: "unknown_port",
        edgeId: edge.id,
        nodeId: target.id,
        message: `${targetDef.label} não tem a porta "${edge.targetHandle}"`,
      });
      continue;
    }
    const portKey = `${edge.target}:${edge.targetHandle}`;
    if (usedPorts.has(portKey)) {
      issues.push({
        code: "port_already_connected",
        edgeId: edge.id,
        nodeId: target.id,
        message: `${targetDef.label}: porta "${port.label}" já tem uma conexão`,
      });
      continue;
    }
    usedPorts.add(portKey);
    const sourceType = effectiveOutputType(edge.source, graph);
    if (sourceType && !port.accepts.includes(sourceType)) {
      issues.push({
        code: "type_mismatch",
        edgeId: edge.id,
        nodeId: target.id,
        message: `${targetDef.label}: porta "${port.label}" não aceita ${sourceType}`,
      });
    }
  }

  for (const nodeId of findCycleNodes(graph)) {
    issues.push({ code: "cycle", nodeId, message: "O flow tem um ciclo — remova a conexão de volta" });
  }

  // Per node: required ports, image_creative ≥1 input, config contract.
  let executable = 0;
  for (const node of graph.nodes) {
    const def = nodeDef(node.type);
    if (!def) continue;
    if (def.kind === "action") executable++;

    const inbound = incomingByNode.get(node.id) ?? [];
    for (const port of def.inputPorts) {
      if (port.required && !inbound.some((e) => e.targetHandle === port.key)) {
        issues.push({
          code: "required_port_unconnected",
          nodeId: node.id,
          message: `${def.label}: conecte a porta "${port.label}"`,
        });
      }
    }
    if (node.type === "image_creative" && inbound.length === 0) {
      issues.push({
        code: "image_creative_no_input",
        nodeId: node.id,
        message: "Criativo de imagem: conecte ao Scraping e/ou à Copy (≥1)",
      });
    }

    const parsed = def.configSchema.safeParse(node.config);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path.join(".") || "config";
      issues.push({
        code: "invalid_config",
        nodeId: node.id,
        message: `${def.label}: ${field} — ${first?.message ?? "config inválido"}`,
      });
    }
  }

  if (executable === 0) {
    issues.push({ code: "no_executable_node", message: "Adicione pelo menos um card executável" });
  }

  return issues;
}
