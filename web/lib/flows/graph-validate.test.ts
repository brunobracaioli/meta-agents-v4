import { describe, expect, it } from "vitest";
import { effectiveOutputType, findUnsafeUrls, validateGraph } from "@/lib/flows/graph-validate";
import { isSafePublicHttpsUrl } from "@/lib/flows/node-registry";
import { defaultTemplateGraph } from "@/lib/flows/template";
import { flowGraphSchema, type FlowGraph } from "@/lib/flows/validate";

// Fully configured version of the default template — the canonical "runnable" graph.
function runnableGraph(): FlowGraph {
  const graph = defaultTemplateGraph();
  const config: Record<string, Record<string, unknown>> = {
    n_scrape: { url: "https://exemplo.com/pagina-de-vendas" },
    n_meta: {
      campaignType: "OUTCOME_TRAFFIC",
      pageId: "123456789",
      linkUrl: "https://exemplo.com/pagina-de-vendas",
      dailyBudgetCents: 3000,
    },
  };
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (config[n.id] ? { ...n, config: { ...n.config, ...config[n.id] } } : n)),
  };
}

describe("flowGraphSchema", () => {
  it("strips React Flow runtime fields on parse", () => {
    const graph = runnableGraph();
    const dirty = {
      nodes: graph.nodes.map((n) => ({ ...n, selected: true, measured: { width: 200 } })),
      edges: graph.edges,
    };
    const parsed = flowGraphSchema.parse(dirty);
    expect(parsed.nodes[0]).not.toHaveProperty("selected");
    expect(parsed.nodes[0]).not.toHaveProperty("measured");
  });

  it("rejects malformed node ids", () => {
    const res = flowGraphSchema.safeParse({
      nodes: [{ id: "N!", type: "scrape", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });
    expect(res.success).toBe(false);
  });
});

describe("validateGraph", () => {
  it("accepts the fully configured default template", () => {
    expect(validateGraph(runnableGraph())).toEqual([]);
  });

  it("flags incomplete configs on the fresh template (Run stays disabled)", () => {
    const issues = validateGraph(defaultTemplateGraph());
    expect(issues.some((i) => i.code === "invalid_config" && i.nodeId === "n_scrape")).toBe(true);
    expect(issues.some((i) => i.code === "invalid_config" && i.nodeId === "n_meta")).toBe(true);
  });

  it("detects cycles via Kahn", () => {
    const graph = runnableGraph();
    // copy → scrape closes a cycle (scrape has no input port, so wire an artificial edge).
    graph.edges.push({ id: "e_back", source: "n_meta", sourceHandle: "out", target: "n_copy", targetHandle: "scrape" });
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "cycle")).toBe(true);
  });

  it("requires connected required ports", () => {
    const graph = runnableGraph();
    graph.edges = graph.edges.filter((e) => e.id !== "e_scrape_copy");
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "required_port_unconnected" && i.nodeId === "n_copy")).toBe(true);
  });

  it("rejects payload-type mismatches", () => {
    const graph = runnableGraph();
    graph.edges = graph.edges.filter((e) => e.id !== "e_copy_meta");
    // scrape → meta.copy: ScrapeResult is not CopyVariations.
    graph.edges.push({ id: "e_bad", source: "n_scrape", sourceHandle: "out", target: "n_meta", targetHandle: "copy" });
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "type_mismatch")).toBe(true);
  });

  it("rejects a second connection into the same input port", () => {
    const graph = runnableGraph();
    graph.nodes.push({ id: "n_scrape2", type: "scrape", position: { x: 0, y: 500 }, config: { url: "https://outro.com/lp" } });
    graph.edges.push({ id: "e_dup", source: "n_scrape2", sourceHandle: "out", target: "n_copy", targetHandle: "scrape" });
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "port_already_connected")).toBe(true);
  });

  it("requires ≥1 input on image_creative", () => {
    const graph = runnableGraph();
    graph.edges = graph.edges.filter((e) => !["e_scrape_image", "e_copy_image"].includes(e.id));
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "image_creative_no_input" && i.nodeId === "n_image")).toBe(true);
  });

  it("requires at least one executable node", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "n_gate", type: "approval", position: { x: 0, y: 0 }, config: { notifyTelegram: true } }],
      edges: [],
    };
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "no_executable_node")).toBe(true);
  });

  it("caps the graph at 30 nodes", () => {
    const graph = runnableGraph();
    for (let i = 0; i < 30; i++) {
      graph.nodes.push({ id: `n_extra${i}`, type: "scrape", position: { x: i, y: 0 }, config: { url: "https://a.com/x" } });
    }
    const issues = validateGraph(graph);
    expect(issues.some((i) => i.code === "too_many_nodes")).toBe(true);
  });
});

describe("effectiveOutputType (passthrough gates)", () => {
  it("resolves approval to its upstream payload type", () => {
    const graph = runnableGraph();
    expect(effectiveOutputType("n_approval", graph)).toBe("ImageAssets");
  });

  it("falls back to the declared type when the gate is unwired", () => {
    const graph = runnableGraph();
    graph.edges = graph.edges.filter((e) => e.id !== "e_image_approval");
    expect(effectiveOutputType("n_approval", graph)).toBe("Approval");
  });
});

describe("SSRF string layer", () => {
  it.each([
    ["https://exemplo.com/lp", true],
    ["http://exemplo.com/lp", false],
    ["https://exemplo.com:8443/lp", false],
    ["https://localhost/lp", false],
    ["https://10.0.0.4/lp", false],
    ["https://192.168.1.1/lp", false],
    ["https://[::1]/lp", false],
    ["https://intranet/lp", false],
    ["https://app.internal/lp", false],
    ["https://user:pass@exemplo.com/lp", false],
  ])("%s → %s", (url, expected) => {
    expect(isSafePublicHttpsUrl(url)).toBe(expected);
  });

  it("hard-flags present unsafe URLs but tolerates empty/in-progress values", () => {
    const graph = runnableGraph();
    const scrape = graph.nodes.find((n) => n.id === "n_scrape")!;
    scrape.config = { url: "https://192.168.0.10/admin" };
    expect(findUnsafeUrls(graph).some((i) => i.code === "unsafe_url" && i.nodeId === "n_scrape")).toBe(true);

    scrape.config = { url: "" };
    expect(findUnsafeUrls(graph)).toEqual([]);

    scrape.config = { url: "https://ainda-digitando" };
    // parseable but rejected by the host rules → flagged; incomplete strings that don't parse are not.
    expect(findUnsafeUrls(graph).some((i) => i.code === "unsafe_url")).toBe(true);
  });
});
