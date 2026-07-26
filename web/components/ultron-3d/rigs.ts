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
  /**
   * Camera zoom limits (OrbitControls). Give absolute world distances (`min`/`max`) OR
   * factors of the fitted framing distance (`minFactor`/`maxFactor`). Factors adapt to models
   * of very different world scale — a small full-body figure (T-800) framed close to the
   * absolute 0.8 floor gets the same proportional zoom-in room as the larger Ultron bust.
   */
  zoom: { min?: number; max?: number; minFactor?: number; maxFactor?: number };
  /**
   * Optional chrome override for textured models whose dark albedo (baseColor) would tint the
   * forced-metal reflection near-black. Repaints non-emissive materials to a light metal and
   * drops the albedo map so they mirror the studio env like polished steel. Omit for models
   * that are already bright metal (Ultron). `skipMaterials` protects glowing parts by name.
   */
  chrome?: { color: number; roughness?: number; stripAlbedoMap?: boolean; skipMaterials?: string[] };
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
    // Absolute limits — preserves the exact current Ultron zoom behaviour.
    zoom: { min: 0.8, max: 5 },
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
    // Negative: the T-800 jaw bone's local X is inverted vs Ultron's, so a positive angle
    // clenched the mouth shut — negative drops the mandible (opens) on speech.
    jaw: { axis: [1, 0, 0], openAngle: -0.22 },
    // Relative limits — the T-800 is a small full-body model, so proportional zoom lets you
    // get close to the head instead of hitting the floor almost immediately.
    zoom: { minFactor: 0.25, maxFactor: 2.6 },
    // The T-800 body/head ship a very dark albedo (baseColor 0.1 gray) that turned the forced
    // metal near-black. Repaint to mid steel + drop the albedo. roughness is a FLOOR here
    // (the model ships roughness 0 = mirror, which blew out to a white "sun" under the studio
    // env + bloom); 0.44 = brushed steel like Ultron. The emissive red eyes are protected.
    chrome: { color: 0x8c9299, roughness: 0.44, stripAlbedoMap: true, skipMaterials: ["eyeball"] },
  },
};

export const DEFAULT_RIG: RigProfile = RIGS.ultron;
