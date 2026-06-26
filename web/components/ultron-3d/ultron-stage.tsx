"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useUltron } from "@/components/ultron/ultron-provider";
import { NeuralCoreScene } from "@/components/live/neural-core-scene";
import { useNeuralCoreState } from "@/components/live/use-neural-core-state";
import { useFaceTracking, type FaceTrackStatus } from "./use-face-tracking";

const MODEL_URL = "/models/ultron.glb";

// --- Lip-sync tuning (calibrated against the "head jaw" + lip bones of ultron.glb) ----
// The mesh has NO viseme morph targets, only bones. A full-jaw amplitude swing reads as a
// "ventriloquist dummy" (the whole chin drops). Professional speech is the opposite: the
// LIPS part with only a slight jaw movement. We exploit the rig — the lower-lip bones are
// CHILDREN of "head jaw" (so they follow a subtle chin), while the upper-lip bones sit
// under the neck and stay nearly still (as in real speech) — and add an attack/release
// envelope so the mouth articulates instead of flapping with the volume.
const JAW_OPEN_AXIS = new THREE.Vector3(1, 0, 0); // local hinge axis of the jaw (validated)
const JAW_OPEN_ANGLE = 0.13; // radians at full open — SUBTLE chin (primary knob; was 0.42)
const LIP_PART_AXIS = new THREE.Vector3(1, 0, 0); // local axis used to part the lip bones
const LOWER_LIP_ANGLE = 0.1; // extra opening of the lower lips (children of the jaw)
const UPPER_LIP_ANGLE = 0.06; // slight lift of the upper lips (opposite sign)
const SPEECH_GAIN = 1.5; // speech rarely peaks at 1.0; lift the useful range
const SPEECH_FLOOR = 0.05; // deadzone: below this the mouth is fully closed (anti-flutter)
const MOUTH_ATTACK = 0.6; // smoothing when OPENING (fast)
const MOUTH_RELEASE = 0.18; // smoothing when CLOSING (slower → natural, doesn't "flap")

// Idle life: a slow blink and a gentle breathing sway so the avatar never reads as frozen.
const ENABLE_BLINK = true;
const BLINK_ANGLE = 0.28; // radians the upper eyelids rotate to close
const BLINK_PERIOD_S = 5.2; // average seconds between blinks
const BLINK_DURATION_S = 0.16;

// Subtle idle head motion on the neck bone — layered sines at incommensurate frequencies
// (a cheap Perlin-ish noise) so the head softly nods/turns/tilts and never reads as a
// mechanical loop. Peak angles are tiny (a couple of degrees); the face bones are children
// of the neck, so the whole head moves while the mouth keeps articulating on top.
const HEAD_PITCH = 0.11; // nod amplitude in radians (~6.3°) — real up/down (world-space)
const HEAD_YAW = 0.18; // turn amplitude (~10°) — real left/right turn (world-space)
const HEAD_ROLL = 0.09; // tilt amplitude (~5°) — the "kitten" head-cock (world-space)
const HEAD_SPEAK_BOOST = 0.5; // noticeably more head motion while he's talking

// Facial micro-expressions so the face is never dead-still — both idle and while speaking.
// Tiny local-axis rotations (a couple of degrees) of the brow / mouth corners + occasional
// eye saccades (quick darts that then hold). Amplitudes are small enough that the exact
// local bone axis doesn't matter visually; the point is subtle, organic life.
const BROW_INNER_AMP = 0.07; // slow drift of the inner brows (furrow/raise near the nose)
const BROW_OUTER_AMP = 0.065; // slow drift of the outer brows (temple side)
const BROW_ENGAGE_RAISE = 0.11; // brows lift when engaged (speaking / agents active)
const MOUTH_CORNER_AMP = 0.05; // subtle tension/micro-smile at the mouth corners
const EYE_SACCADE_AMP = 0.06; // how far the eyeballs dart on a saccade
const EYE_SACCADE_SNAP = 0.25; // per-frame lerp toward the new gaze target (eyes move fast)
const EYE_MICROSACCADE_AMP = 0.04; // tiny involuntary darts layered on top (even when tracking)
const EYE_FOCUS_SCALE = 0.86; // eyeball contracts to this scale on a focus pulse (then relaxes)
const LOWER_LID_AMP = 0.045; // subtle idle drift of the lower eyelids
const LID_WIDEN_ENGAGE = 0.08; // upper lids open a touch more when engaged (eyes "widen")
const LID_SQUINT_ENGAGE = 0.07; // lower lids rise a touch when engaged (focus squint)
const BLINK_LOWER_ANGLE = 0.12; // lower lids rise during a blink (sign calibratable)
const NECK_LOWER_AMP = 0.03; // secondary neck motion so the neck chain isn't rigid
const ENGAGE_SMOOTH = 0.08; // how fast the engagement scalar follows its target

// Body language: torso + shoulders, like a human talking. The spine drives a slow breathing
// sway of the whole upper body; the shoulder bones add a subtle drift + a "retract/settle"
// when engaged. Kept small — the camera frames the head/upper-chest, and these bones carry
// the arms, so big angles would swing the (mostly off-frame) arms.
const SPINE_AMP = 0.02; // slow torso sway / breathing
const SHOULDER_AMP = 0.018; // idle shoulder drift
const SHOULDER_ENGAGE = 0.03; // shoulders retract/settle a bit when speaking / active

// === Conversational gestures (robot, speech-synced) =====================================
// Ultron is a ROBOT (Iron-Man-ish), so the motion has a specific quality — not human jitter.
// Three layers compose, all in CANONICAL limb space then mirrored per side:
//   1. POSTURE — when he starts SPEAKING the forearms rise from a contained idle into a
//      "ready to talk" zone (elbows bent, hands in front at chest); they relax on silence.
//      This is what reads as natural — NOT raising the whole arm from the side.
//   2. BASE — a small RMS-driven life: louder speech recruits more of the chain
//      (wrist→elbow→shoulder). Subtle ("sutil vivo"), heavy/slow easing, no jitter.
//   3. ACCENTS — discrete gesture strokes triggered by speech ONSETS (so they land on the
//      stressed syllables), each prep→stroke→hold→retract back to the posture. Mostly a
//      fluid-weighted profile; ~1 in 5 (and the strongest onsets) snap to a dry SERVO/STACCATO
//      profile — that fluid→staccato contrast is the "cold AI" personality.
//
// The rig is "Y-up per bone" (every child sits at [0, len, 0] of its parent), so local axes
// are uniform across the arm chain:
//   X local = FLEX  (bend the elbow / lift the forearm forward-up)  → same sign both arms
//   Y local = TWIST (supinate = palm up / pronate = palm down)      → mirrored per side
//   Z local = ABDUCT (swing the arm out from the body)              → mirrored per side
// The exact SENSE of each can only be eyeballed in a render, so each is one sign constant.
const GESTURE_INTENSITY = 1.0; // global scale of accent angles (1 = moderate/natural)
const FLEX_SIGN = -1; // bends the elbow / lifts the forearm FORWARD-UP (was +1 → bent backward)
const FINGER_SIGN = 1; // curls the fingers toward the palm (decoupled from FLEX_SIGN; flip if they hyperextend)
const TWIST_SIGN = 1; // + SUPINATES (palm up) on the right arm (flip if it pronates)
const ABDUCT_SIGN = 1; // + swings the arm OUT from the body (flip if it crosses inward)

// Idle (silent) contained neutral — every motion departs from and returns to this.
const NEUTRAL_ELBOW = 0.16; // slight bend so the arm never reads as a stiff straight rod
const NEUTRAL_ABDUCT = -0.55; // pull the upper arms IN toward the body at rest (the GLB bind pose
//                               spreads them wide); canonical, mirrored per side. Flip sign if they spread MORE.
const FINGER_REST_CURL = 0.2; // hands half-open, not a flat board
// "Ready to talk" posture blended in by `speakingPosture` (0→1 when speaking): forearms come
// UP IN FRONT (big elbow bend), a touch of shoulder flex + supination, hands a bit more open.
const POSTURE_ELBOW = 0.78; // forearms rise to chest height (hands enter the close frame)
const POSTURE_UPPER_ARM_FLEX = 0.12; // small — the upper arm stays near the torso (no "maluco")
const POSTURE_FOREARM_TWIST = 0.25; // palms angle slightly inward/up, conversational
const POSTURE_FINGER = 0.14; // hands open a little more when engaged
const POSTURE_RATE = 2.6; // rise/fall speed of the talk posture, per second (dt-normalized)

// BASE: RMS (level 0..1) → subtle chain recruitment while speaking. Small amplitudes.
const BASE_WRIST = 0.18; // wrist/hand respond first (lowest level)
const BASE_ELBOW = 0.22; // elbow joins past BASE_ELBOW_FLOOR
const BASE_ELBOW_FLOOR = 0.25;
const BASE_UPPER = 0.16; // upper-arm/shoulder only on the loud peaks
const BASE_UPPER_FLOOR = 0.5;
const BASE_RATE = 5; // how fast the heavy base eases toward its target, per second (dt-normalized)
// The raw RMS (`level`) is instantaneous and jumpy — driving the arm off it shivers per-syllable.
// `levelSlow` is a slow envelope of it so the base swells over phrases instead of trembling.
const LEVEL_SLOW_RATE = 4; // smoothing rate of the loudness that drives the arm base, per second

// ONSET detection over the (already smoothed) RMS envelope → fires accents on stressed beats.
const ONSET_FLOOR = 0.16; // absolute level an onset must exceed
const ONSET_MARGIN = 0.09; // how far above the adaptive baseline counts as an onset
const ONSET_BASELINE_EASE = 0.04; // EMA rate of the loudness baseline
const ONSET_REFRACTORY_S = 0.7; // min gap between accents (spaced so each reads as deliberate/complete)
const ONSET_FALLBACK_S = 2.6; // if speaking but no onset fired this long, gesture anyway
const STACCATO_STRONG = 0.2; // onset strength above which a dry staccato is likely
const STACCATO_CHANCE = 0.22; // base probability an accent uses the staccato profile
const GESTURE_BOTH_CHANCE = 0.18; // probability an accent uses BOTH arms

// Motion profiles (seconds). Fluid = weighted/elegant, no overshoot. Staccato = servo snap.
const FLUID_RISE_S = 0.28;
const FLUID_HOLD_MIN_S = 0.3;
const FLUID_HOLD_MAX_S = 0.7;
const FLUID_RETURN_S = 0.45;
const STACCATO_RISE_S = 0.1; // fast, near-linear
const STACCATO_OVERSHOOT = 0.08; // tiny 1–2 frame overshoot, then locks
const STACCATO_HOLD_MIN_S = 0.18;
const STACCATO_HOLD_MAX_S = 0.32;
const STACCATO_RETURN_S = 0.18;

// Gaze tracking: when the webcam locates the user's face, the head + eyes turn toward them.
// Eyes lead (snap), head eases behind; ambient motion stays but reduced so he's anchored on
// the user without freezing. Limits keep him from over-rotating off a glance.
const GAZE_HEAD_YAW = 0.32; // max head turn toward the user (~18°)
const GAZE_HEAD_PITCH = 0.2; // max head nod toward the user (~11°)
const GAZE_EYE_AMP = 0.13; // how far the eyes rotate to lock on (eyes lead the head)
const GAZE_SMOOTH = 0.1; // how fast the head eases toward the gaze target
// The head's gaze turn is applied in WORLD space about these axes (then converted into the
// neck bone's local frame), because the neck bone's local Y points FORWARD, not up — a
// local-axis "yaw" only tilts the head instead of turning it left/right toward the user.
const WORLD_UP = new THREE.Vector3(0, 1, 0); // yaw axis (turn left/right)
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0); // pitch axis (nod up/down)
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1); // roll axis (tilt the head — "kitten cock")
const GAZE_YAW_SIGN = 1; // flip to -1 if the head turns away from the user instead of toward
const GAZE_PITCH_SIGN = 1; // flip to -1 if the head nods the wrong way

// Stainless-steel look. The GLB ships metalness=1 / roughness=1, and a metallic PBR
// material with no environment to reflect renders as a near-black metal — that's why
// Ultron looked "dark". We give the scene a procedural studio environment (IBL) to
// reflect, and polish the metal (lower roughness) so each panel reads as brushed steel.
const STEEL_ROUGHNESS = 0.38; // 0 = mirror, 1 = matte; ~0.38 = brushed stainless steel
const STEEL_ENV_INTENSITY = 1.3; // how strongly the steel reflects the studio environment

const FACE_STATUS_LABEL: Record<FaceTrackStatus, string> = {
  off: "Olhar livre",
  loading: "Iniciando câmera…",
  tracking: "Te observando",
  "no-face": "Procurando rosto…",
  denied: "Câmera negada",
  error: "Falha no rastreio",
};

type LoadStatus = "loading" | "ready" | "error";

type BonePose = { bone: THREE.Object3D; rest: THREE.Quaternion };

// One side's arm chain. Each entry carries its rest quaternion so a gesture is applied as
// rest · Δ(local-axis rotation); `side` is +1 (right) / −1 (left) for mirroring twist+abduct.
type ArmChain = {
  side: number;
  upperArm: BonePose | null; // "arm * shoulder 2" — flex (X), abduct (Z), twist (Y)
  rollUpper: BonePose | null; // upper-arm twist bone — carries part of the supination
  elbow: BonePose | null; // forearm — flex (X)
  rollLower: BonePose | null; // forearm twist bone — carries most of the supination (palm up)
  wrist: BonePose | null; // hand — slight flex (X) + twist (Y)
  fingers: BonePose[]; // proximal finger segments — curl (X)
};

// A gesture stroke as ADDITIVE deltas (radians) on top of the talk posture — NOT an absolute
// pose. Small and forearm-centric (twist/elbow/wrist/fingers), barely any upper arm, so it
// reads as conversational hand-talk, not "raising the whole arm". Supination is split across
// both forearm-twist bones. `both` = both arms; `prefersStaccato` biases the dry servo profile.
type GesturePose = {
  name: string;
  both?: boolean;
  prefersStaccato?: boolean;
  weight?: number;
  upperArmFlex?: number;
  upperArmAbduct?: number;
  upperArmTwist?: number;
  elbowFlex?: number;
  forearmTwist?: number; // supination delta; distributed rollUpper(0.35) + rollLower(0.65)
  wristFlex?: number;
  wristTwist?: number;
  fingerCurl?: number; // delta: negative opens the hand, positive closes it
};

// Small conversational strokes layered over the "ready to talk" posture (elbows already bent,
// hands in front). The expression lives in the forearm twist (palm up/down), small elbow lifts
// and the hand — the upper arm hardly moves.
const GESTURE_LIBRARY: GesturePose[] = [
  // Signature "here's the idea": palm rolls up, hand opens, tiny forearm lift.
  { name: "palmUp", weight: 3, forearmTwist: 0.5, elbowFlex: 0.12, wristFlex: 0.05, upperArmFlex: 0.06, fingerCurl: -0.06 },
  // Emphasis beat — a short downward stab of the forearm + hand a bit more closed (staccato-friendly).
  { name: "beat", weight: 2.5, prefersStaccato: true, elbowFlex: 0.2, wristFlex: 0.12, forearmTwist: 0.1, fingerCurl: 0.12 },
  // Both hands present, palms up/inward — "let me explain".
  { name: "present", both: true, weight: 1.2, forearmTwist: 0.4, elbowFlex: 0.08, upperArmAbduct: 0.08, fingerCurl: -0.05 },
  // Subtle point/indicate — slight pronation toward neutral, hand a touch closed.
  { name: "point", weight: 1.5, elbowFlex: 0.14, wristFlex: 0.08, forearmTwist: -0.16, fingerCurl: 0.1 },
  // Open outward — a bit of abduction, palm up.
  { name: "openOut", weight: 1.2, upperArmAbduct: 0.18, forearmTwist: 0.32, elbowFlex: 0.05, fingerCurl: -0.05 },
];

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

// Smootherstep (Ken Perlin) — flatter ends than smoothstep, for the weighted fluid profile.
function smootherstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// easeOutBack — overshoots slightly past 1 then settles exactly to 1 at t=1. Drives the dry
// SERVO/STACCATO snap (a 1–2 frame overshoot, then locks). `overshoot` ≈ the peak fraction over 1.
function easeOutBack(t: number, overshoot: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = overshoot * 17;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function pickGesture(): GesturePose {
  const total = GESTURE_LIBRARY.reduce((s, g) => s + (g.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const g of GESTURE_LIBRARY) {
    r -= g.weight ?? 1;
    if (r <= 0) return g;
  }
  return GESTURE_LIBRARY[0]!;
}

export function UltronStage({
  heightClassName = "h-[calc(100vh-9rem)] min-h-[480px]",
  showBackdrop = true,
}: { heightClassName?: string; showBackdrop?: boolean } = {}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { liveSignalRef } = useUltron();
  const [status, setStatus] = useState<LoadStatus>("loading");
  // Same agent-driven state that powers /dashboard/live, so the arc reactor behind Ultron
  // lights up exactly when the agents do (including Ultron-triggered runs).
  const coreState = useNeuralCoreState();
  // Mirror "are agents active?" into a ref so the rAF loop can read it per-frame (the
  // render closure is built once) to drive Ultron's facial reaction when the core fires.
  const coreActiveRef = useRef(false);
  coreActiveRef.current = coreState.mode === "activated";
  // Opt-in on-device webcam face tracking → the avatar looks at the user (gazeRef, no re-render).
  const { enabled: faceEnabled, status: faceStatus, toggle: toggleFace, gazeRef } = useFaceTracking();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.12);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    camera.position.set(0, 1.7, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // Transparent clear so the arc-reactor canvas behind this one shows through; OutputPass
    // preserves per-fragment alpha, so only the avatar (and its bloom halo) stays opaque.
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.cursor = "grab";
    host.appendChild(renderer.domElement);

    // PBR materials need light. A cool key + cyan rim sells the JARVIS cockpit look;
    // the model's own emissive (eyes / chest) carries the glow through bloom.
    const ambient = new THREE.AmbientLight(0x8fbfff, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.2, 3.2, 2.6);
    const fill = new THREE.DirectionalLight(0x66ccff, 0.7);
    fill.position.set(-2.6, 1.2, 1.4);
    const rim = new THREE.PointLight(0x22d3ee, 1.4, 12, 2);
    rim.position.set(0, 2.0, -2.2);
    scene.add(ambient, key, fill, rim);

    // Image-based lighting: a procedural studio environment so the (fully metallic) GLB has
    // something to reflect. Without it, metalness=1 renders as a near-black metal. We set
    // ONLY scene.environment (reflections) — the visible cockpit background stays dark, so
    // the polished steel pops against it with every element well defined.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmrem.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 0.8;
    controls.maxDistance = 5;
    renderer.domElement.style.touchAction = "pan-y";
    const onControlsStart = () => {
      renderer.domElement.style.cursor = "grabbing";
    };
    const onControlsEnd = () => {
      renderer.domElement.style.cursor = "grab";
    };
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("end", onControlsEnd);

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(pixelRatio);
    const renderPass = new RenderPass(scene, camera);
    // strength, radius, threshold — threshold high so only the bright emissive blooms.
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.82);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    // --- live, per-frame state (refs/closures only — never React state) ---
    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);
    let jaw: BonePose | null = null;
    let head: BonePose | null = null; // "head neck upper" — parent of all the face bones
    let neckLower: BonePose | null = null;
    let spineUpper: BonePose | null = null;
    const shoulders: BonePose[] = [];
    // Per-side arm chains for conversational gestures (filled in the bone traverse below).
    const arms: Record<"left" | "right", ArmChain> = {
      left: { side: -1, upperArm: null, rollUpper: null, elbow: null, rollLower: null, wrist: null, fingers: [] },
      right: { side: 1, upperArm: null, rollUpper: null, elbow: null, rollLower: null, wrist: null, fingers: [] },
    };
    const lowerLips: BonePose[] = [];
    const upperLips: BonePose[] = [];
    const eyelids: BonePose[] = []; // upper eyelids (blink + widen)
    const lowerEyelids: BonePose[] = [];
    const browsInner: BonePose[] = [];
    const browsOuter: BonePose[] = [];
    const eyes: BonePose[] = [];
    const mouthCorners: BonePose[] = [];
    const emissiveMaterials: THREE.MeshStandardMaterial[] = [];
    let mouthOpen = 0; // enveloped 0..1 mouth openness; also drives the emissive/bloom pulse
    let engage = 0; // 0..1 facial "engagement": rises while speaking and when agents are active

    // --- Gesture runtime (live browser rAF → Math.random is fine for variety) ----------------
    let speakingPosture = 0; // 0..1 — forearms relaxed-down → "ready to talk" (rises while speaking)
    let levelSlow = 0; // slow envelope of the RMS, drives the arm base (no per-syllable shiver)
    let levelBaseline = 0; // EMA of the RMS envelope, for onset detection
    let lastAccentAt = -10; // elapsed of the last accent trigger (refractory + fallback)

    // Active accent stroke (additive over the posture/base).
    type GesturePhase = "idle" | "rising" | "holding" | "returning";
    let gPhase: GesturePhase = "idle";
    let gActive: GesturePose | null = null;
    let gStaccato = false; // motion profile of the active accent
    let gUseLeft = false;
    let gUseRight = false;
    let gLastRight = false; // alternate the leading arm between accents
    let gPhaseStart = 0; // elapsed at the start of the current phase
    let gHoldDur = 0; // randomized hold duration for this accent
    let gAmount = 0; // 0..1 accent envelope (rise → [overshoot] → hold → return)

    // Per-side current (eased) canonical angles. `base` carries neutral+posture+RMS (slow/heavy);
    // the accent is added on top per frame. Keeping base eased gives the weighted, no-jitter feel.
    type ArmAngles = {
      upperArmFlex: number; upperArmAbduct: number; upperArmTwist: number;
      elbowFlex: number; forearmTwist: number; wristFlex: number; wristTwist: number; fingerCurl: number;
    };
    const zeroAngles = (): ArmAngles => ({
      upperArmFlex: 0, upperArmAbduct: NEUTRAL_ABDUCT, upperArmTwist: 0,
      elbowFlex: NEUTRAL_ELBOW, forearmTwist: 0, wristFlex: 0, wristTwist: 0, fingerCurl: FINGER_REST_CURL,
    });
    const armBase: Record<"left" | "right", ArmAngles> = { left: zeroAngles(), right: zeroAngles() };

    const baseBloom = bloomPass.strength;
    let disposed = false;

    const jawQuat = new THREE.Quaternion();
    const lipQuat = new THREE.Quaternion();
    const blinkQuat = new THREE.Quaternion();
    const headQuat = new THREE.Quaternion();
    const headEuler = new THREE.Euler();
    const faceQuat = new THREE.Quaternion();
    const eyeEuler = new THREE.Euler();
    // Scratch for the arm/hand gesture rotations (built once; set per-bone each frame).
    const armEuler = new THREE.Euler();
    const armQuat = new THREE.Quaternion();
    // Scratch quaternions for the world-space gaze turn of the head (see the head block).
    const gazeParentQuat = new THREE.Quaternion();
    const gazeWorldDelta = new THREE.Quaternion();
    const gazeLocalDelta = new THREE.Quaternion();
    const gazeTmpQuat = new THREE.Quaternion();
    const gazeTmpQuat2 = new THREE.Quaternion();
    // Eye-saccade state: current gaze + the target it darts to, refreshed at loose intervals.
    let eyeYaw = 0;
    let eyePitch = 0;
    let eyeTargetYaw = 0;
    let eyeTargetPitch = 0;
    let nextSaccadeAt = 0;
    // Involuntary micro-saccades (always on) + a periodic "focus" contraction of the eyeball.
    let eyeMicroYaw = 0;
    let eyeMicroPitch = 0;
    let nextMicroAt = 0;
    let focusScale = 1;
    let focusUntil = 0;
    let nextFocusAt = 2;
    // Eased head orientation toward the user (when face tracking is active).
    let headGazeYaw = 0;
    let headGazePitch = 0;

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        avatarGroup.add(model);

        model.traverse((obj) => {
          // Skinned meshes pose far from their bind box; disable culling so the head
          // never pops out of view when the camera is tight on the face.
          const asMesh = obj as THREE.Mesh;
          if (asMesh.isMesh) {
            asMesh.frustumCulled = false;
            const mats = Array.isArray(asMesh.material) ? asMesh.material : [asMesh.material];
            for (const mat of mats) {
              const std = mat as THREE.MeshStandardMaterial;
              if (!std || !std.isMeshStandardMaterial) continue;
              // Polished stainless steel that reflects the studio environment (metalness
              // stays 1 — the GLB is already all-metal; we only un-matte it and let it
              // catch the IBL so it stops reading as a dark blob).
              std.metalness = 1;
              std.roughness = Math.min(std.roughness ?? 1, STEEL_ROUGHNESS);
              std.envMapIntensity = STEEL_ENV_INTENSITY;
              std.needsUpdate = true;
              // Only materials that actually emit (eyes / chest panel) get the voice glow
              // pulse — a black emissive would never show anyway.
              const emits =
                !!std.emissiveMap ||
                (!!std.emissive && std.emissive.r + std.emissive.g + std.emissive.b > 0);
              if (emits) {
                std.emissiveIntensity = 1.4;
                emissiveMaterials.push(std);
              }
            }
          }
          if ((obj as THREE.Bone).isBone) {
            const name = obj.name.toLowerCase();
            const pose = (): BonePose => ({ bone: obj, rest: obj.quaternion.clone() });
            if (!jaw && name.includes("jaw")) {
              jaw = pose();
            } else if (!head && name.includes("neck") && name.includes("upper")) {
              head = pose();
            } else if (!neckLower && name.includes("neck") && name.includes("lower")) {
              neckLower = pose();
            } else if (name.includes("lip") && name.includes("lower")) {
              lowerLips.push(pose());
            } else if (name.includes("lip") && name.includes("upper")) {
              upperLips.push(pose());
            } else if (name.includes("eyebrow") && name.endsWith("1")) {
              browsInner.push(pose()); // segment 1 = inner (near the nose)
            } else if (name.includes("eyebrow")) {
              browsOuter.push(pose()); // segment 2 = outer (temple side)
            } else if (name.includes("eyeball")) {
              eyes.push(pose());
            } else if (name.includes("mouth corner")) {
              mouthCorners.push(pose());
            } else if (name.includes("eyelid") && name.includes("upper")) {
              eyelids.push(pose());
            } else if (name.includes("eyelid") && name.includes("lower")) {
              lowerEyelids.push(pose());
            } else if (!spineUpper && name.includes("spine") && name.includes("upper")) {
              spineUpper = pose();
            } else if (name.includes("shoulder") && name.endsWith("1")) {
              shoulders.push(pose()); // primary shoulder bone per side (carries the arm)
            } else if (name.includes("arm") && name.includes("left")) {
              // Left arm chain → gesture rig.
              const a = arms.left;
              if (name.includes("shoulder") && name.endsWith("2")) a.upperArm = pose();
              else if (name.includes("roll") && name.includes("upper")) a.rollUpper = pose();
              else if (name.includes("roll") && name.includes("lower")) a.rollLower = pose();
              else if (name.includes("elbow")) a.elbow = pose();
              else if (name.includes("wrist")) a.wrist = pose();
              else if (name.includes("finger") && name.endsWith("a")) a.fingers.push(pose());
            } else if (name.includes("arm") && name.includes("right")) {
              // Right arm chain → gesture rig.
              const a = arms.right;
              if (name.includes("shoulder") && name.endsWith("2")) a.upperArm = pose();
              else if (name.includes("roll") && name.includes("upper")) a.rollUpper = pose();
              else if (name.includes("roll") && name.includes("lower")) a.rollLower = pose();
              else if (name.includes("elbow")) a.elbow = pose();
              else if (name.includes("wrist")) a.wrist = pose();
              else if (name.includes("finger") && name.endsWith("a")) a.fingers.push(pose());
            }
          }
        });

        // Frame the head: target just below the top of the bounding box and pull the
        // camera back enough to show face + glowing chest panel.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const headY = box.max.y - size.y * 0.1;
        const target = new THREE.Vector3(center.x, headY, center.z);
        const headSpan = size.y * 0.38;
        const dist = (headSpan / Math.tan((camera.fov * Math.PI) / 180 / 2)) * 1.05;
        controls.target.copy(target);
        camera.position.set(target.x, headY + size.y * 0.02, center.z + dist);
        camera.updateProjectionMatrix();
        controls.update();

        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("error");
      },
    );

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const clock = new THREE.Clock();
    let elapsed = 0;
    let raf = 0;

    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;
      const motion = reducedMotion ? 0.3 : 1;

      const live = liveSignalRef.current;
      const speaking = live.status === "speaking";
      // Map the speaking amplitude through a deadzone + gain, then an attack/release
      // envelope so the mouth articulates (opens fast, closes slower) instead of flapping
      // 1:1 with the volume — and snaps fully shut on silence between words.
      const raw = speaking ? Math.max(0, (live.level - SPEECH_FLOOR) / (1 - SPEECH_FLOOR)) : 0;
      const target = Math.min(1, raw * SPEECH_GAIN);
      mouthOpen += (target - mouthOpen) * (target > mouthOpen ? MOUTH_ATTACK : MOUTH_RELEASE);

      // Facial "engagement": calm when idle, up while speaking, peak when agents are active.
      // Drives brow lift, eye widening/squint and saccade energy so Ultron reacts to work.
      const targetEngage = Math.max(speaking ? 0.45 : 0, mouthOpen, coreActiveRef.current ? 0.8 : 0);
      engage += (targetEngage - engage) * ENGAGE_SMOOTH;

      // --- Speech-driven gestures: posture rises while speaking; accents fire on speech onsets.
      const level = live.level; // instantaneous RMS of the spoken audio (jumpy — good for onsets)
      // Slow envelope of the loudness for the arm base (swells over phrases, no per-syllable shiver),
      // plus dt-normalized eases so motion stays smooth even when the FPS is uneven (2 WebGL canvases).
      levelSlow += (level - levelSlow) * (1 - Math.exp(-LEVEL_SLOW_RATE * dt));
      const postureE = 1 - Math.exp(-POSTURE_RATE * dt);
      // Talk posture: forearms rise into the "ready to talk" zone while speaking, relax on silence.
      speakingPosture += ((speaking ? 1 : 0) - speakingPosture) * postureE;

      // Adaptive loudness baseline + onset detection → accents land on the stressed syllables.
      levelBaseline += (level - levelBaseline) * ONSET_BASELINE_EASE;
      const onsetStrength = level - levelBaseline;
      const canTrigger = elapsed - lastAccentAt >= ONSET_REFRACTORY_S;
      const onset = speaking && level > ONSET_FLOOR && onsetStrength > ONSET_MARGIN;
      const fallback = speaking && elapsed - lastAccentAt >= ONSET_FALLBACK_S; // keep alive on flat speech
      if (gPhase === "idle" && canTrigger && (onset || fallback)) {
        gActive = pickGesture();
        // Strong onsets (or a "beat") tend to snap as a dry servo/staccato — the cold-AI accent.
        const strong = onsetStrength >= STACCATO_STRONG;
        gStaccato =
          Math.random() < STACCATO_CHANCE + (strong ? 0.35 : 0) + (gActive.prefersStaccato ? 0.25 : 0);
        if (gActive.both || Math.random() < GESTURE_BOTH_CHANCE) {
          gUseLeft = true;
          gUseRight = true;
        } else {
          gLastRight = !gLastRight; // alternate the leading arm between accents
          gUseRight = gLastRight;
          gUseLeft = !gLastRight;
        }
        const hMin = gStaccato ? STACCATO_HOLD_MIN_S : FLUID_HOLD_MIN_S;
        const hMax = gStaccato ? STACCATO_HOLD_MAX_S : FLUID_HOLD_MAX_S;
        gHoldDur = hMin + Math.random() * (hMax - hMin);
        gPhase = "rising";
        gPhaseStart = elapsed;
        lastAccentAt = elapsed;
      } else if (!speaking && (gPhase === "rising" || gPhase === "holding")) {
        gPhase = "returning"; // cut to the return as soon as he stops talking
        gPhaseStart = elapsed;
      }
      // Advance the accent envelope with its motion profile.
      const riseS = gStaccato ? STACCATO_RISE_S : FLUID_RISE_S;
      const returnS = gStaccato ? STACCATO_RETURN_S : FLUID_RETURN_S;
      if (gPhase === "rising") {
        const t = (elapsed - gPhaseStart) / riseS;
        gAmount = gStaccato ? easeOutBack(t, STACCATO_OVERSHOOT) : smootherstep(t);
        if (t >= 1) {
          gAmount = 1;
          gPhase = "holding";
          gPhaseStart = elapsed;
        }
      } else if (gPhase === "holding") {
        gAmount = 1;
        if (elapsed - gPhaseStart >= gHoldDur) {
          gPhase = "returning";
          gPhaseStart = elapsed;
        }
      } else if (gPhase === "returning") {
        const t = (elapsed - gPhaseStart) / returnS;
        gAmount = gStaccato ? 1 - smoothstep(t) : 1 - smootherstep(t);
        if (t >= 1) {
          gAmount = 0;
          gPhase = "idle";
          gActive = null;
          gUseLeft = false;
          gUseRight = false;
        }
      } else {
        gAmount = 0;
      }

      // Blink envelope (shared by upper + lower lids): a quick triangular close on a loose cadence.
      const blinkPhase = (elapsed % BLINK_PERIOD_S) / BLINK_DURATION_S;
      const blink = ENABLE_BLINK && blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) : 0;

      // Lip-sync: the chin moves only slightly while the lips part — the lower lips follow
      // the (subtle) jaw, the upper lips lift a touch the other way.
      if (jaw) {
        jawQuat.setFromAxisAngle(JAW_OPEN_AXIS, JAW_OPEN_ANGLE * mouthOpen);
        jaw.bone.quaternion.copy(jaw.rest).multiply(jawQuat);
      }
      for (const lip of lowerLips) {
        lipQuat.setFromAxisAngle(LIP_PART_AXIS, LOWER_LIP_ANGLE * mouthOpen);
        lip.bone.quaternion.copy(lip.rest).multiply(lipQuat);
      }
      for (const lip of upperLips) {
        lipQuat.setFromAxisAngle(LIP_PART_AXIS, -UPPER_LIP_ANGLE * mouthOpen);
        lip.bone.quaternion.copy(lip.rest).multiply(lipQuat);
      }

      // Upper eyelids: blink (closes, +) competes with a slight widen when engaged (opens, −)
      // so the eyes "open up" when Ultron is alert. Blink wins while it fires.
      if (eyelids.length > 0) {
        const lidAngle = BLINK_ANGLE * blink - LID_WIDEN_ENGAGE * engage * (1 - blink);
        blinkQuat.setFromAxisAngle(JAW_OPEN_AXIS, lidAngle);
        for (const lid of eyelids) lid.bone.quaternion.copy(lid.rest).multiply(blinkQuat);
      }

      // Facial micro-expressions — keep the face alive whether silent or talking.
      // Eyebrows: inner (near nose) and outer (temple) drift on separate phases and lift
      // when engaged; a per-bone phase adds slight L/R asymmetry so it never reads robotic.
      if (browsInner.length > 0) {
        const d = Math.sin(elapsed * 0.6 + 0.5) * 0.5 + Math.sin(elapsed * 0.27) * 0.5;
        browsInner.forEach((b, i) => {
          const asym = Math.sin(elapsed * 0.5 + i * 1.7) * 0.3;
          const a = ((d + asym) * BROW_INNER_AMP + engage * BROW_ENGAGE_RAISE) * motion;
          faceQuat.setFromAxisAngle(JAW_OPEN_AXIS, a);
          b.bone.quaternion.copy(b.rest).multiply(faceQuat);
        });
      }
      if (browsOuter.length > 0) {
        const d = Math.sin(elapsed * 0.43 + 2.3) * 0.5 + Math.sin(elapsed * 0.19 + 1.1) * 0.5;
        browsOuter.forEach((b, i) => {
          const asym = Math.sin(elapsed * 0.37 + i * 2.1) * 0.3;
          const a = ((d + asym) * BROW_OUTER_AMP + engage * BROW_ENGAGE_RAISE * 0.8) * motion;
          faceQuat.setFromAxisAngle(JAW_OPEN_AXIS, a);
          b.bone.quaternion.copy(b.rest).multiply(faceQuat);
        });
      }
      // Lower eyelids: subtle idle drift + focus "squint" when engaged + a rise during the
      // blink (the lower lid participates too, like a real blink).
      if (lowerEyelids.length > 0) {
        const d = Math.sin(elapsed * 0.33 + 1.2) * 0.5 + Math.sin(elapsed * 0.21) * 0.5;
        const a = (d * LOWER_LID_AMP + engage * LID_SQUINT_ENGAGE) * motion + BLINK_LOWER_ANGLE * blink;
        faceQuat.setFromAxisAngle(JAW_OPEN_AXIS, a);
        for (const lid of lowerEyelids) lid.bone.quaternion.copy(lid.rest).multiply(faceQuat);
      }
      // Mouth corners: subtle tension/micro-smile, plus a touch of pull while speaking.
      if (mouthCorners.length > 0) {
        const corner = Math.sin(elapsed * 0.4 + 2.0) * 0.5 + Math.sin(elapsed * 0.17) * 0.5;
        const cornerAngle = (corner * MOUTH_CORNER_AMP + mouthOpen * MOUTH_CORNER_AMP * 0.6) * motion;
        faceQuat.setFromAxisAngle(JAW_OPEN_AXIS, cornerAngle);
        for (const c of mouthCorners) c.bone.quaternion.copy(c.rest).multiply(faceQuat);
      }
      // Eyes: when tracking, they lock onto the user; otherwise they make ambient saccades.
      // In BOTH modes an involuntary micro-saccade jitter is layered on top so the eyeball is
      // never perfectly still. A periodic "focus" pulse contracts the eyeball, then relaxes.
      const gaze = gazeRef.current;
      if (eyes.length > 0) {
        // Involuntary micro-saccades — refreshed on a fast, loose cadence (always on).
        if (elapsed >= nextMicroAt) {
          eyeMicroYaw = (Math.random() * 2 - 1) * EYE_MICROSACCADE_AMP;
          eyeMicroPitch = (Math.random() * 2 - 1) * EYE_MICROSACCADE_AMP * 0.6;
          nextMicroAt = elapsed + 0.35 + Math.random() * 1.1;
        }
        if (gaze.active) {
          // Eyes lock onto the user (they lead; the head eases in behind, below).
          eyeTargetYaw = Math.max(-1, Math.min(1, gaze.yaw)) * GAZE_EYE_AMP;
          eyeTargetPitch = Math.max(-1, Math.min(1, gaze.pitch)) * GAZE_EYE_AMP * 0.7;
        } else if (elapsed >= nextSaccadeAt) {
          const amp = EYE_SACCADE_AMP * (1 + engage * 0.6); // wider darts when engaged
          eyeTargetYaw = (Math.random() * 2 - 1) * amp;
          eyeTargetPitch = (Math.random() * 2 - 1) * amp * 0.6;
          const hold = engage > 0.5 ? 0.5 + Math.random() * 1.0 : 1.4 + Math.random() * 2.8;
          nextSaccadeAt = elapsed + hold;
        }
        eyeYaw += (eyeTargetYaw + eyeMicroYaw - eyeYaw) * EYE_SACCADE_SNAP;
        eyePitch += (eyeTargetPitch + eyeMicroPitch - eyePitch) * EYE_SACCADE_SNAP;
        eyeEuler.set(eyePitch, eyeYaw, 0, "XYZ");
        faceQuat.setFromEuler(eyeEuler);

        // Focus pulse: occasionally the eyeball contracts (focusing) then relaxes back to 1.
        if (elapsed >= nextFocusAt) {
          focusUntil = elapsed + 0.45;
          nextFocusAt = elapsed + 3 + Math.random() * 4;
        }
        const focusTarget = elapsed < focusUntil ? EYE_FOCUS_SCALE : 1;
        focusScale += (focusTarget - focusScale) * 0.2;

        for (const e of eyes) {
          e.bone.quaternion.copy(e.rest).multiply(faceQuat);
          e.bone.scale.setScalar(focusScale);
        }
      }

      // Head: layered slow sines give an organic ambient nod/turn/tilt. When face tracking
      // is active, the head EASES toward the user (gaze) and the ambient is dialed down so
      // he stays anchored on them but never freezes. Ease the gaze offset back to 0 when the
      // user leaves frame.
      if (head) {
        const speak = 1 + (speaking ? HEAD_SPEAK_BOOST : 0);
        // Ambient "looking around": layered incommensurate sines for an organic nod (pitch),
        // turn (yaw) and tilt (roll — the "kitten" head-cock). Applied in WORLD space below, so
        // yaw is a REAL left/right turn and pitch a REAL up/down nod. (The neck bone's local Y
        // points forward, so a local-euler yaw only tilted the head — that's why it never
        // seemed to actually turn.)
        const ambPitch = (Math.sin(elapsed * 0.5) * 0.6 + Math.sin(elapsed * 0.23 + 1.3) * 0.4) * HEAD_PITCH * motion * speak;
        const ambYaw = (Math.sin(elapsed * 0.37 + 2.1) * 0.6 + Math.sin(elapsed * 0.19 + 0.7) * 0.4) * HEAD_YAW * motion * speak;
        const ambRoll = (Math.sin(elapsed * 0.31 + 4.2) * 0.6 + Math.sin(elapsed * 0.17 + 3.1) * 0.4) * HEAD_ROLL * motion * speak;

        const targetGazeYaw = gaze.active ? Math.max(-1, Math.min(1, gaze.yaw)) * GAZE_HEAD_YAW : 0;
        const targetGazePitch = gaze.active ? Math.max(-1, Math.min(1, gaze.pitch)) * GAZE_HEAD_PITCH : 0;
        headGazeYaw += (targetGazeYaw - headGazeYaw) * GAZE_SMOOTH;
        headGazePitch += (targetGazePitch - headGazePitch) * GAZE_SMOOTH;

        // Combine ambient + gaze. Ambient dials down (but never off) while locked on the user.
        const amb = gaze.active ? 0.45 : 1;
        const worldYaw = ambYaw * amb + headGazeYaw * GAZE_YAW_SIGN;
        const worldPitch = ambPitch * amb + headGazePitch * GAZE_PITCH_SIGN;
        const worldRoll = ambRoll * (gaze.active ? 0.6 : 1);

        // Apply the whole turn in WORLD space about up (yaw) / right (pitch) / forward (roll),
        // converted into the bone's local frame (parentWorld⁻¹ · Δworld · parentWorld) and
        // premultiplied onto the rest pose so it composes correctly with the neck chain.
        head.bone.quaternion.copy(head.rest);
        const p = head.bone.parent;
        if (p) {
          p.updateWorldMatrix(true, false);
          p.getWorldQuaternion(gazeParentQuat);
          gazeWorldDelta
            .setFromAxisAngle(WORLD_UP, worldYaw)
            .multiply(gazeTmpQuat.setFromAxisAngle(WORLD_RIGHT, worldPitch))
            .multiply(gazeTmpQuat2.setFromAxisAngle(WORLD_FORWARD, worldRoll));
          gazeLocalDelta.copy(gazeParentQuat).invert().multiply(gazeWorldDelta).multiply(gazeParentQuat);
          head.bone.quaternion.premultiply(gazeLocalDelta);
        } else {
          headEuler.set(worldPitch, worldYaw, worldRoll, "XYZ");
          head.bone.quaternion.multiply(headQuat.setFromEuler(headEuler));
        }
      }

      // Lower neck: a small secondary motion on a different phase so the neck reads as a
      // chain (head leads, neck base follows) instead of a rigid pivot.
      if (neckLower) {
        const nPitch = Math.sin(elapsed * 0.29 + 0.9) * NECK_LOWER_AMP * motion;
        const nYaw = Math.sin(elapsed * 0.23 + 3.4) * NECK_LOWER_AMP * motion;
        headEuler.set(nPitch, nYaw, 0, "XYZ");
        headQuat.setFromEuler(headEuler);
        neckLower.bone.quaternion.copy(neckLower.rest).multiply(headQuat);
      }

      // Torso: slow breathing/weight-shift of the whole upper body (the spine carries the
      // shoulders + neck + head, so this is the base of the body language), faster breath
      // component on top.
      if (spineUpper) {
        const sway = Math.sin(elapsed * 0.27 + 1.5) * SPINE_AMP;
        const breath = Math.sin(elapsed * 0.85) * SPINE_AMP * 0.4;
        const tilt = Math.cos(elapsed * 0.19 + 0.6) * SPINE_AMP * 0.5;
        headEuler.set(breath, sway, tilt, "XYZ");
        headQuat.setFromEuler(headEuler);
        spineUpper.bone.quaternion.copy(spineUpper.rest).multiply(headQuat);
      }

      // Shoulders: a subtle idle drift plus a "retract/settle" when engaged (talking / agents
      // active) — like a human shifting their shoulders while speaking. Small, with slight
      // L/R asymmetry; large angles would swing the arms (mostly off-frame).
      if (shoulders.length > 0) {
        const drift = Math.sin(elapsed * 0.5 + 1.0) * 0.5 + Math.sin(elapsed * 0.27 + 2.0) * 0.5;
        shoulders.forEach((s, i) => {
          const asym = Math.sin(elapsed * 0.4 + i * 2.0) * 0.4;
          const a = ((drift + asym) * SHOULDER_AMP + engage * SHOULDER_ENGAGE) * motion;
          faceQuat.setFromAxisAngle(JAW_OPEN_AXIS, a);
          s.bone.quaternion.copy(s.rest).multiply(faceQuat);
        });
      }

      // --- Conversational gestures: compose POSTURE + RMS BASE (eased, heavy) + ACCENT (additive),
      // then write each arm in canonical limb space with per-side mirroring. The rig is Y-up per
      // bone: flex about X (shared sign L/R), twist about Y + abduct about Z (mirrored via side).
      const sp = speakingPosture;
      // Talk-posture canonical pose, blended in by `sp` (forearms rise in front when speaking).
      const postElbow = NEUTRAL_ELBOW + (POSTURE_ELBOW - NEUTRAL_ELBOW) * sp;
      const postUpperFlex = POSTURE_UPPER_ARM_FLEX * sp;
      const postTwist = POSTURE_FOREARM_TWIST * sp;
      const postFinger = FINGER_REST_CURL - POSTURE_FINGER * sp; // open the hand a touch when talking
      // RMS recruitment — small "alive" response to loudness, driven by the SLOW envelope (no shiver).
      const recWrist = levelSlow * BASE_WRIST * motion;
      const recElbow = Math.max(0, levelSlow - BASE_ELBOW_FLOOR) * BASE_ELBOW * motion;
      const recUpper = Math.max(0, levelSlow - BASE_UPPER_FLOOR) * BASE_UPPER * motion;
      const baseE = 1 - Math.exp(-BASE_RATE * dt); // dt-normalized ease for the heavy base

      (["left", "right"] as const).forEach((key) => {
        const chain = arms[key];
        if (!chain.upperArm && !chain.elbow) return; // this arm isn't in the rig
        const base = armBase[key];
        const e = baseE;
        // Low-frequency idle life on the distal joints (per-side phase) so they aren't dead-still.
        const phase = key === "left" ? 0 : 2.3;
        const life = Math.sin(elapsed * 0.7 + phase) * 0.5 + Math.sin(elapsed * 0.41 + phase) * 0.5;
        // Ease the slow/heavy base toward its target pose (weight, no jitter).
        base.upperArmFlex += (postUpperFlex + recUpper - base.upperArmFlex) * e;
        base.upperArmAbduct += (NEUTRAL_ABDUCT - base.upperArmAbduct) * e;
        base.upperArmTwist += (0 - base.upperArmTwist) * e;
        base.elbowFlex += (postElbow + recElbow - base.elbowFlex) * e;
        base.forearmTwist += (postTwist + life * 0.03 * motion - base.forearmTwist) * e;
        base.wristFlex += (recWrist + life * 0.05 * motion - base.wristFlex) * e;
        base.wristTwist += (0 - base.wristTwist) * e;
        base.fingerCurl += (postFinger - base.fingerCurl) * e;

        // Additive accent stroke (only the participating side).
        const participating = key === "left" ? gUseLeft : gUseRight;
        const acc = gActive && participating ? gActive : null;
        const amt = acc ? gAmount * GESTURE_INTENSITY * motion : 0;

        const side = chain.side;
        const upperFlex = base.upperArmFlex + (acc?.upperArmFlex ?? 0) * amt;
        const upperTwist = base.upperArmTwist + (acc?.upperArmTwist ?? 0) * amt;
        const upperAbduct = base.upperArmAbduct + (acc?.upperArmAbduct ?? 0) * amt;
        const elbowFlex = base.elbowFlex + (acc?.elbowFlex ?? 0) * amt;
        const forearmTwist = base.forearmTwist + (acc?.forearmTwist ?? 0) * amt;
        const wristFlex = base.wristFlex + (acc?.wristFlex ?? 0) * amt;
        const wristTwist = base.wristTwist + (acc?.wristTwist ?? 0) * amt;
        const fingerCurl = base.fingerCurl + (acc?.fingerCurl ?? 0) * amt;

        if (chain.upperArm) {
          armEuler.set(upperFlex * FLEX_SIGN, upperTwist * TWIST_SIGN * side, upperAbduct * ABDUCT_SIGN * side, "XYZ");
          chain.upperArm.bone.quaternion.copy(chain.upperArm.rest).multiply(armQuat.setFromEuler(armEuler));
        }
        if (chain.rollUpper) {
          armEuler.set(0, forearmTwist * 0.35 * TWIST_SIGN * side, 0, "XYZ");
          chain.rollUpper.bone.quaternion.copy(chain.rollUpper.rest).multiply(armQuat.setFromEuler(armEuler));
        }
        if (chain.elbow) {
          armEuler.set(elbowFlex * FLEX_SIGN, 0, 0, "XYZ");
          chain.elbow.bone.quaternion.copy(chain.elbow.rest).multiply(armQuat.setFromEuler(armEuler));
        }
        if (chain.rollLower) {
          armEuler.set(0, forearmTwist * 0.65 * TWIST_SIGN * side, 0, "XYZ");
          chain.rollLower.bone.quaternion.copy(chain.rollLower.rest).multiply(armQuat.setFromEuler(armEuler));
        }
        if (chain.wrist) {
          armEuler.set(wristFlex * FLEX_SIGN, wristTwist * TWIST_SIGN * side, 0, "XYZ");
          chain.wrist.bone.quaternion.copy(chain.wrist.rest).multiply(armQuat.setFromEuler(armEuler));
        }
        if (chain.fingers.length > 0) {
          armEuler.set(fingerCurl * FINGER_SIGN, 0, 0, "XYZ");
          armQuat.setFromEuler(armEuler);
          for (const f of chain.fingers) f.bone.quaternion.copy(f.rest).multiply(armQuat);
        }
      });

      // Faint whole-body weight-shift sway, kept very subtle so it complements (not fights)
      // the head motion. Deliberately NO vertical motion — that's what made it "bounce".
      avatarGroup.rotation.y = Math.sin(elapsed * 0.21) * 0.022 * motion;

      // Emissive + bloom breathe with the voice: Ultron lights up when he speaks.
      const glow = 1.4 + mouthOpen * 1.8 + (speaking ? 0.2 : 0);
      for (const mat of emissiveMaterials) {
        mat.emissiveIntensity += (glow - mat.emissiveIntensity) * 0.2;
      }
      bloomPass.strength += (baseBloom + mouthOpen * 0.9 - bloomPass.strength) * 0.15;

      controls.update();
      composer.render();
      raf = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) mat?.dispose();
        }
      });
      envTexture.dispose();
      scene.environment = null;
      bloomPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [liveSignalRef, gazeRef]);

  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-cyan-300/15 bg-black ${heightClassName}`}>
      {/* Living backdrop: the exact arc reactor from /dashboard/live, driven by the same
          agent state — it activates when the agents do. Behind the avatar, non-interactive.
          Opt-out on the live cockpit, where the arc reactor is already its own sibling screen. */}
      {showBackdrop ? (
        <div className="pointer-events-none absolute inset-0 z-0">
          <NeuralCoreScene state={coreState} heightClassName="h-full" />
        </div>
      ) : null}

      {/* Avatar canvas on top, transparent so the reactor shows through. Receives pointer
          events for OrbitControls. */}
      <div ref={hostRef} className="absolute inset-0 z-10 h-full w-full" aria-label="Avatar 3D do Ultron" />

      {/* Cockpit chrome — HUD corners + grid, matching the JARVIS language of the live tab. */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute left-4 top-4 font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-200/60">
          ULTRON · PRIME
        </div>
        <div className="absolute right-4 top-4 font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-200/40">
          {status === "ready" ? "ONLINE" : status === "error" ? "OFFLINE" : "BOOT…"}
        </div>
        <div className="absolute left-3 top-3 h-6 w-6 border-l border-t border-cyan-300/40" />
        <div className="absolute right-3 top-3 h-6 w-6 border-r border-t border-cyan-300/40" />
        <div className="absolute bottom-3 left-3 h-6 w-6 border-b border-l border-cyan-300/40" />
        <div className="absolute bottom-3 right-3 h-6 w-6 border-b border-r border-cyan-300/40" />
      </div>

      {/* Opt-in webcam face tracking — Ultron looks at the user. Camera runs on-device. */}
      <button
        type="button"
        onClick={toggleFace}
        aria-pressed={faceEnabled}
        title="Liga a webcam (no seu navegador) para o Ultron olhar para você. As imagens não saem do dispositivo."
        className={`pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] backdrop-blur-md transition ${
          faceEnabled
            ? "border-cyan-300/45 bg-cyan-400/15 text-cyan-100"
            : "border-white/15 bg-black/40 text-white/65 hover:border-cyan-200/35 hover:text-white"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            faceStatus === "tracking"
              ? "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]"
              : faceStatus === "denied" || faceStatus === "error"
                ? "bg-red-400"
                : faceEnabled
                  ? "bg-cyan-300"
                  : "bg-white/30"
          }`}
        />
        {faceEnabled ? FACE_STATUS_LABEL[faceStatus] : "Ultron te observa"}
      </button>

      {status !== "ready" && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/80">
          {status === "loading" ? (
            <div className="flex flex-col items-center gap-3 font-mono text-xs uppercase tracking-[0.24em] text-cyan-200/70">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-200" />
              Inicializando Ultron…
            </div>
          ) : (
            <p className="max-w-xs px-6 text-center font-mono text-xs uppercase tracking-[0.18em] text-red-300/80">
              Falha ao carregar o modelo 3D do Ultron.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
