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

// Visemes: the mouth FORMS like a human's instead of only flapping. The speaking spectrum
// (liveSignalRef.shape) gives `open` (jaw aperture, from F1) and `wide` ∈ [-1,1] (spread for
// front vowels E/I → +, rounded for back vowels O/U → −). With bones only (no blendshapes) we
// approximate: open vowels widen the jaw/lips, spread pulls the mouth corners apart, rounding
// pulls them in + purses the lips ("bico"). Axes/signs are calibratable like everything else.
const VISEME_OPEN_WEIGHT = 0.6; // how much the spectral openness boosts the amplitude jaw drive
const VISEME_CORNER_WIDE = 0.13; // corners pull out/up on a spread vowel (E/I)
const VISEME_CORNER_ROUND = 0.1; // corners pull in on a rounded vowel (O/U)
const VISEME_LIP_PURSE = 0.06; // lips come together / project on rounding (the "bico")
const VISEME_SMOOTH = 0.3; // how fast the mouth eases toward the target shape
const VISEME_CORNER_AXIS = new THREE.Vector3(0, 0, 1); // local axis read as widen/round (calibratable)

// Cheek disc: the GLB's baked cheek disc has no bone, so it can't spin. We overlay a procedural
// emissive disc parented to the head bone (it tracks head/gaze) and spin it — faster when Ultron
// is engaged (talking / agents active), tying it to the arc reactor's energy. Sizing/placement
// is derived from the model's bounding box at load; offsets are calibratable fractions.
const DISC_RADIUS_FRAC = 0.05; // disc radius as a fraction of model height
const DISC_SIDE_FRAC = 0.2; // sideways offset from the face center (× model width)
const DISC_DOWN_FRAC = 0.06; // drop below the head-frame line (× model height)
const DISC_FWD_FRAC = 0.33; // push toward the face front (× model depth)
const DISC_YAW = 0.5; // outward yaw so each cheek disc faces slightly out (radians)
const DISC_SPIN_BASE = 0.6; // idle spin speed (rad/s)
const DISC_SPIN_ENGAGE = 3.5; // extra spin while engaged (talking / agents active)
const DISC_COLOR = 0x38e8ff; // cyan, bright enough to pass the bloom threshold

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

// Procedural turbine-like disc (built at radius 1; the caller scales it). Ring + hub + spokes
// so the spin is readable; unlit additive cyan so it glows through the bloom pass. Returned as a
// group whose local Z is the spin axis — rotate `.rotation.z` to make it turn.
function makeCheekDisc(): THREE.Group {
  const disc = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: DISC_COLOR,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40), mat);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), mat);
  disc.add(ring, hub);
  const spokeGeo = new THREE.PlaneGeometry(0.08, 0.62);
  for (let i = 0; i < 6; i++) {
    const pivot = new THREE.Group();
    const spoke = new THREE.Mesh(spokeGeo, mat);
    spoke.position.set(0, 0.46, 0);
    pivot.add(spoke);
    pivot.rotation.z = (i / 6) * Math.PI * 2;
    disc.add(pivot);
  }
  disc.traverse((o) => {
    (o as THREE.Mesh).frustumCulled = false;
  });
  disc.renderOrder = 2;
  return disc;
}

export function UltronStage() {
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
    const lowerLips: BonePose[] = [];
    const upperLips: BonePose[] = [];
    const eyelids: BonePose[] = []; // upper eyelids (blink + widen)
    const lowerEyelids: BonePose[] = [];
    const browsInner: BonePose[] = [];
    const browsOuter: BonePose[] = [];
    const eyes: BonePose[] = [];
    const mouthCorners: BonePose[] = [];
    const cheekDiscs: THREE.Object3D[] = []; // spinning overlay discs (children of the head bone)
    const emissiveMaterials: THREE.MeshStandardMaterial[] = [];
    let mouthOpen = 0; // enveloped 0..1 mouth openness; also drives the emissive/bloom pulse
    let engage = 0; // 0..1 facial "engagement": rises while speaking and when agents are active
    let visemeOpen = 0; // smoothed spectral openness (F1) → boosts the jaw aperture on open vowels
    let visemeWide = 0; // smoothed spread(+)/round(−) from the F2/F1 tilt → shapes the mouth
    const baseBloom = bloomPass.strength;
    let disposed = false;

    const jawQuat = new THREE.Quaternion();
    const lipQuat = new THREE.Quaternion();
    const blinkQuat = new THREE.Quaternion();
    const headQuat = new THREE.Quaternion();
    const headEuler = new THREE.Euler();
    const faceQuat = new THREE.Quaternion();
    const eyeEuler = new THREE.Euler();
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

        // Cheek discs: parent to the head bone so they track head/gaze. Placement is derived
        // from the bounding box (a world point on each cheek), converted into the bone's local
        // frame; the disc is scaled into world units through the bone's world scale; and its
        // rest orientation cancels the bone's world rotation (so it faces forward at rest, then
        // turns WITH the head as the bone animates). A spinner child rotates about its normal.
        if (head) {
          head.bone.updateWorldMatrix(true, false);
          const boneQuat = head.bone.getWorldQuaternion(new THREE.Quaternion());
          const boneScale = head.bone.getWorldScale(new THREE.Vector3());
          const worldRadius = size.y * DISC_RADIUS_FRAC;
          const localScale = worldRadius / Math.max(1e-4, boneScale.x);
          for (const side of [-1, 1]) {
            const wrapper = new THREE.Group();
            const worldTarget = new THREE.Vector3(
              center.x + side * size.x * DISC_SIDE_FRAC,
              headY - size.y * DISC_DOWN_FRAC,
              center.z + size.z * DISC_FWD_FRAC,
            );
            wrapper.position.copy(head.bone.worldToLocal(worldTarget));
            wrapper.quaternion.copy(boneQuat.clone().invert());
            wrapper.rotateY(side * DISC_YAW);
            wrapper.scale.setScalar(localScale);
            const spinner = makeCheekDisc();
            wrapper.add(spinner);
            head.bone.add(wrapper);
            cheekDiscs.push(spinner);
          }
        }

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

      // Blink envelope (shared by upper + lower lids): a quick triangular close on a loose cadence.
      const blinkPhase = (elapsed % BLINK_PERIOD_S) / BLINK_DURATION_S;
      const blink = ENABLE_BLINK && blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) : 0;

      // Visemes: ease the spectral shape (open/wide) and turn the amplitude flap into vowel
      // articulation. `aperture` is the jaw/lip opening — amplitude-gated (so silence still
      // closes the mouth) but boosted by spectral openness on open vowels. `round` (0..1) purses
      // the lips on back vowels (O/U).
      visemeOpen += (live.shape.open - visemeOpen) * VISEME_SMOOTH;
      visemeWide += (live.shape.wide - visemeWide) * VISEME_SMOOTH;
      const aperture = Math.min(1, mouthOpen * (1 + visemeOpen * VISEME_OPEN_WEIGHT));
      const round = Math.max(0, -visemeWide);

      // Lip-sync: the chin moves only slightly while the lips part — the lower lips follow the
      // (subtle) jaw, the upper lips lift a touch the other way; rounding brings the lips back
      // together (protrusion) so "O/U" don't read as a wide-open flap.
      if (jaw) {
        jawQuat.setFromAxisAngle(JAW_OPEN_AXIS, JAW_OPEN_ANGLE * aperture);
        jaw.bone.quaternion.copy(jaw.rest).multiply(jawQuat);
      }
      for (const lip of lowerLips) {
        lipQuat.setFromAxisAngle(LIP_PART_AXIS, LOWER_LIP_ANGLE * aperture - VISEME_LIP_PURSE * round);
        lip.bone.quaternion.copy(lip.rest).multiply(lipQuat);
      }
      for (const lip of upperLips) {
        lipQuat.setFromAxisAngle(LIP_PART_AXIS, -UPPER_LIP_ANGLE * aperture + VISEME_LIP_PURSE * round);
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
      // Mouth corners: subtle idle tension + the viseme spread/round. Spread (wide>0) pulls the
      // corners apart (E/I); round (wide<0) pulls them in (O/U). Mirrored per side so it's
      // symmetric. The idle drift stays uniform so the resting mouth keeps its micro-life.
      if (mouthCorners.length > 0) {
        const idle = (Math.sin(elapsed * 0.4 + 2.0) * 0.5 + Math.sin(elapsed * 0.17) * 0.5) * MOUTH_CORNER_AMP;
        const spread = visemeWide > 0 ? visemeWide * VISEME_CORNER_WIDE : visemeWide * VISEME_CORNER_ROUND;
        for (const c of mouthCorners) {
          const side = c.bone.name.toLowerCase().includes("right") ? -1 : 1;
          const a = (idle + spread * side) * motion;
          faceQuat.setFromAxisAngle(VISEME_CORNER_AXIS, a);
          c.bone.quaternion.copy(c.rest).multiply(faceQuat);
        }
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

      // Faint whole-body weight-shift sway, kept very subtle so it complements (not fights)
      // the head motion. Deliberately NO vertical motion — that's what made it "bounce".
      avatarGroup.rotation.y = Math.sin(elapsed * 0.21) * 0.022 * motion;

      // Cheek discs spin continuously and speed up with engagement (talking / agents active),
      // tying them to the arc reactor's energy. They're children of the head bone, so they
      // already track the head/gaze; here we only turn them about their own normal (local Z).
      if (cheekDiscs.length > 0) {
        const spin = dt * (DISC_SPIN_BASE + engage * DISC_SPIN_ENGAGE) * motion;
        for (const disc of cheekDiscs) disc.rotation.z += spin;
      }

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
    <div className="relative h-[calc(100vh-9rem)] min-h-[480px] w-full overflow-hidden rounded-lg border border-cyan-300/15 bg-black">
      {/* Living backdrop: the exact arc reactor from /dashboard/live, driven by the same
          agent state — it activates when the agents do. Behind the avatar, non-interactive. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <NeuralCoreScene state={coreState} heightClassName="h-full" />
      </div>

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
