import { z } from "zod";
import { NODE_TYPES, OUTPUT_HANDLE } from "@/lib/flows/node-registry";

// SPEC-020 §3.6 — Zod contracts for the persisted graph jsonb and the /api/flows request
// bodies. z.object() strips unknown keys on parse, which is exactly the spec'd behavior:
// React Flow runtime fields (selected, measured, …) never reach the database.

export const nodeIdSchema = z.string().regex(/^[a-z0-9_]{2,24}$/, "id de node inválido");

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const graphNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.enum(NODE_TYPES),
  position: positionSchema,
  // Config values are validated per node type in graph-validate.ts (an in-progress draft may
  // hold an incomplete config); the SHAPE is always enforced here.
  config: z.record(z.unknown()).default({}),
});

export const graphEdgeSchema = z.object({
  id: z.string().min(1).max(48),
  source: nodeIdSchema,
  sourceHandle: z.string().min(1).max(24).default(OUTPUT_HANDLE),
  target: nodeIdSchema,
  targetHandle: z.string().min(1).max(24),
});

export const flowGraphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(30, "máximo de 30 nodes por flow"),
  edges: z.array(graphEdgeSchema).max(120),
});

export type FlowGraph = z.infer<typeof flowGraphSchema>;
export type FlowGraphNode = z.infer<typeof graphNodeSchema>;
export type FlowGraphEdge = z.infer<typeof graphEdgeSchema>;

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

// --- Request bodies ------------------------------------------------------------------------

export const flowCreateSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export const flowPatchSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    // 'archived' only via DELETE (soft archive) — keeps the two intents separate.
    status: z.enum(["draft", "active"]).optional(),
    graph: flowGraphSchema.optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.description !== undefined || d.status !== undefined || d.graph !== undefined,
    { message: "patch vazio" },
  );
