import type { FlowGraph } from "@/lib/flows/validate";
import { defaultConfig } from "@/lib/flows/node-registry";

// SPEC-020 §8.15 — every new flow starts from this template: the full v1 pipeline with the
// human-approval gate wired BEFORE the Meta card (operator's decision, ADR 0034 §6). The
// approval gate is passthrough, so meta_campaign receives the ImageAssets untouched.

export function defaultTemplateGraph(): FlowGraph {
  return {
    nodes: [
      { id: "n_scrape", type: "scrape", position: { x: 0, y: 200 }, config: defaultConfig("scrape") },
      { id: "n_copy", type: "copy", position: { x: 340, y: 40 }, config: defaultConfig("copy") },
      { id: "n_image", type: "image_creative", position: { x: 340, y: 340 }, config: defaultConfig("image_creative") },
      { id: "n_approval", type: "approval", position: { x: 700, y: 340 }, config: defaultConfig("approval") },
      { id: "n_meta", type: "meta_campaign", position: { x: 1040, y: 190 }, config: defaultConfig("meta_campaign") },
    ],
    edges: [
      { id: "e_scrape_copy", source: "n_scrape", sourceHandle: "out", target: "n_copy", targetHandle: "scrape" },
      { id: "e_scrape_image", source: "n_scrape", sourceHandle: "out", target: "n_image", targetHandle: "scrape" },
      { id: "e_copy_image", source: "n_copy", sourceHandle: "out", target: "n_image", targetHandle: "copy" },
      { id: "e_image_approval", source: "n_image", sourceHandle: "out", target: "n_approval", targetHandle: "payload" },
      { id: "e_approval_meta", source: "n_approval", sourceHandle: "out", target: "n_meta", targetHandle: "images" },
      { id: "e_copy_meta", source: "n_copy", sourceHandle: "out", target: "n_meta", targetHandle: "copy" },
    ],
  };
}
