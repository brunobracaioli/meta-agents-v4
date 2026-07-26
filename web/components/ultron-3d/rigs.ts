// Rig profiles for the 3D avatar stage (UltronStage). A profile carries everything that
// differs between models: the GLB URL, how the camera frames the head, the jaw hinge used
// for lip-sync, and the HUD/loading labels. The bone-matching in ultron-stage.tsx stays
// model-agnostic (substring match) — a model whose bones don't match simply animates the
// bones it does have (e.g. the T-800 has "Bip_jaw" + "Bip_eyeball" and nothing else the
// Ultron rig looks for, so it lip-syncs + moves its eyes but doesn't gesture).
//
// Adding a model = drop its .glb in web/public/models and add a profile here.

export type RigId = "ultron" | "terminator";

export type RigProfile = {
  id: RigId;
  /** HUD label shown top-left over the avatar (font-mono, tracked). */
  label: string;
  /** Short name used in the loading/error overlay ("Inicializando {displayName}…"). */
  displayName: string;
  /** Root-relative URL served from web/public. */
  url: string;
  /**
   * Head-and-shoulders auto-framing, applied to the model's bounding box after load:
   * - topBias:    fraction of the box height, below its top, used as the look-at Y.
   * - spanFactor: fraction of the box height the camera frames vertically (smaller = tighter).
   * - distFactor: extra pull-back multiplier on the fitted distance.
   */
  framing: { topBias: number; spanFactor: number; distFactor: number };
  /**
   * Jaw lip-sync hinge (bones only — no visemes). `axis` is the jaw bone's LOCAL open axis;
   * `openAngle` is the radians of drop at full amplitude. Calibrated per rig.
   */
  jaw: { axis: [number, number, number]; openAngle: number };
};

export const RIGS: Record<RigId, RigProfile> = {
  // Current avatar — values preserved exactly from the previous hardcoded constants so the
  // default behaviour is unchanged.
  ultron: {
    id: "ultron",
    label: "ULTRON · PRIME",
    displayName: "Ultron",
    url: "/models/ultron.glb",
    framing: { topBias: 0.1, spanFactor: 0.38, distFactor: 1.05 },
    jaw: { axis: [1, 0, 0], openAngle: 0.13 },
  },
  // Terminator T-800 [SFM]. Full-body biped (~112 nodes / 96 joints), so it's framed much
  // tighter than the Ultron bust (smaller spanFactor). Has "Bip_jaw" + "Bip_eyeball" bones
  // that match the shared lip-sync/eye logic; the jaw opens a touch wider for the metal
  // mandible. framing/jaw are starting values — expect a visual tuning pass.
  terminator: {
    id: "terminator",
    label: "T-800 · CYBERDYNE",
    displayName: "T-800",
    url: "/models/terminator_t-800_sfm.glb",
    framing: { topBias: 0.11, spanFactor: 0.2, distFactor: 1.1 },
    jaw: { axis: [1, 0, 0], openAngle: 0.24 },
  },
};

export const DEFAULT_RIG: RigProfile = RIGS.ultron;
