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
  chrome?: {
    color: number;
    roughness?: number;
    /** Reflection strength. Lower than Ultron's 1.3 for a very convex model that would
     *  otherwise catch bright env highlights from every angle and bloom out to white. */
    envMapIntensity?: number;
    stripAlbedoMap?: boolean;
    skipMaterials?: string[];
  };
  /**
   * Optional localized eye emission. The glb eye material emits a UNIFORM color (the whole
   * eyeball glows); darken the globe and gate emission through a mask texture (white where the
   * pupil is, black elsewhere) so only the pupil lights up. By default the voice pulse still
   * modulates it; set `glowIntensity` to pin the pupil to a CONSTANT glow (kept out of the
   * voice-pulsed emissive set) — the always-on red eye of the T-800.
   */
  eyes?: {
    material: string;
    globeColor: number;
    emissiveMaskUrl: string;
    emissiveColor: number;
    glowIntensity?: number;
  };
  /**
   * Optional explicit bone map for models whose skeleton naming doesn't match the default
   * anatomical heuristics (e.g. the T-800's 3ds Max Biped: bip_head / bip_neck / bip_spine /
   * bip_collar). Each value is a lowercase SUBSTRING matched against the bone name. When
   * present it REPLACES the heuristic matcher for these slots (jaw + eyeball still match by
   * substring on both rigs). Omit for models that follow the default naming (Ultron). Arms are
   * intentionally not mapped here: at head-and-shoulders framing the forearms/hands sit below
   * the frame, and the shoulder bones already carry the visible arm-region motion.
   */
  bones?: {
    /** Head pivot — nod/turn/tilt is applied in world space, so any orientation works. */
    head?: string;
    /** Secondary neck motion (chain follow). */
    neckLower?: string;
    /** Upper torso sway/breath (carries the shoulders + neck + head). */
    spineUpper?: string;
    /** Shoulder/collar bones for the subtle idle shoulder drift. */
    shoulders?: string[];
  };
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
    // Match Ultron's exact treatment. The T-800's only defect vs Ultron is baseColorFactor
    // [0.1,0.1,0.1] (the artist darkened the steel texture to 10% → near-black) + roughness 0
    // (mirror). Ultron uses a WHITE base with its texture kept, metalness 1, roughness 0.38,
    // env 1.3 — the texture supplies the detail + light/dark contrast that reads as polished
    // steel. So here: KEEP the albedo map, set the base back to white (undo the 0.1), and use
    // Ultron's roughness/env. Stripping the map was the mistake — it removed the variation and
    // left a uniform surface (a "sun" when smooth, matte plastic when rough).
    // Texture is now kept (Ultron's treatment), but the T-800 still reads brighter than
    // Ultron because its steel texture is lighter AND its smooth convex skull mirrors the
    // bright studio env uniformly (Ultron's angular panels self-shadow) — so it feeds the
    // shared bloom more. There is no extra glow layer; the fix is to lower the base-color
    // MULTIPLIER (0.5 gray, not white). For a metal this dims both the env reflection and the
    // direct-light specular proportionally while keeping the texture's light/dark contrast.
    chrome: {
      color: 0x808080,
      roughness: 0.38,
      envMapIntensity: 1.3,
      stripAlbedoMap: false,
      skipMaterials: ["eyeball"],
    },
    // Black eye globe with only the pupil glowing red (the glb emits red across the whole
    // eyeball). t800_eye_emissive.png is a mask derived from the eye texture: white pupil on
    // black, so emission is confined to the pupil.
    // glowIntensity pins the pupil to a CONSTANT red glow (out of the voice pulse) — the
    // T-800's always-on red eye, instead of a glow that breathes with speech like Ultron.
    // It MUST clear the bloom threshold to actually glow: red has a low luminance weight
    // (0.2126), and the UnrealBloomPass threshold is 0.82, so a red only starts to bloom above
    // intensity ~3.9 (0.82/0.2126). 2.6 sat below it → a flat salmon dot with no halo. 7.0
    // clears it with margin → a strong red bloom halo. The scene tone-maps with ACES (which
    // shifts a bright pure red toward orange), so the vivid-red read comes from the large,
    // lower-magnitude bloom HALO (ACES desaturates it far less than the hot core).
    eyes: {
      material: "eyeball",
      globeColor: 0x080808,
      emissiveMaskUrl: "/models/t800_eye_emissive.png",
      emissiveColor: 0xff0000,
      glowIntensity: 7.0,
    },
    // The T-800 is a 3ds Max Biped; its bones (bip_head/bip_neck/bip_spine_3/bip_collar_*)
    // don't match Ultron's anatomical heuristics, so map them explicitly to get the same
    // head/neck/torso/shoulder body language. jaw + eyeball still match by substring.
    bones: {
      head: "bip_head",
      neckLower: "bip_neck",
      spineUpper: "bip_spine_3",
      shoulders: ["bip_collar"],
    },
  },
};

export const DEFAULT_RIG: RigProfile = RIGS.ultron;
