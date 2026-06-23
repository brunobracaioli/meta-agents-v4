"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { useUltron } from "@/components/ultron/ultron-provider";

const MODEL_URL = "/models/ultron.glb";

// --- Lip-sync tuning (calibrated against the "head jaw" bone of ultron.glb) ---------
// The mesh has NO viseme morph targets, only a jaw bone, so we drive an amplitude-based
// open/close: the speaking RMS level (0..1, already smoothed in the voice hook) rotates
// the jaw about its local axis. These constants are the empirical knobs — flip the axis
// or the sign here if the mouth opens the wrong way / on the wrong hinge.
const JAW_OPEN_AXIS = new THREE.Vector3(1, 0, 0); // local hinge axis of the jaw bone
const JAW_OPEN_ANGLE = 0.42; // radians at full volume
const JAW_SMOOTHING = 0.35; // 0..1 — higher = snappier, lower = smoother (anti-jitter)

// Idle life: a slow blink and a gentle breathing sway so the avatar never reads as frozen.
const ENABLE_BLINK = true;
const BLINK_ANGLE = 0.28; // radians the upper eyelids rotate to close
const BLINK_PERIOD_S = 5.2; // average seconds between blinks
const BLINK_DURATION_S = 0.16;

type LoadStatus = "loading" | "ready" | "error";

type BonePose = { bone: THREE.Object3D; rest: THREE.Quaternion };

export function UltronStage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { liveSignalRef } = useUltron();
  const [status, setStatus] = useState<LoadStatus>("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02060f, 0.12);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    camera.position.set(0, 1.7, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x02060f, 1);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
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
    const eyelids: BonePose[] = [];
    const emissiveMaterials: THREE.MeshStandardMaterial[] = [];
    let smoothedLevel = 0;
    const baseBloom = bloomPass.strength;
    let disposed = false;

    const deltaQuat = new THREE.Quaternion();
    const blinkQuat = new THREE.Quaternion();

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
              if (std && std.isMeshStandardMaterial && (std.emissiveMap || std.emissive)) {
                std.emissiveIntensity = 1.4;
                emissiveMaterials.push(std);
              }
            }
          }
          if ((obj as THREE.Bone).isBone) {
            const name = obj.name.toLowerCase();
            if (!jaw && name.includes("jaw")) {
              jaw = { bone: obj, rest: obj.quaternion.clone() };
            } else if (name.includes("eyelid") && name.includes("upper")) {
              eyelids.push({ bone: obj, rest: obj.quaternion.clone() });
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
      const targetLevel = speaking ? live.level : 0;
      smoothedLevel += (targetLevel - smoothedLevel) * JAW_SMOOTHING;

      // Lip-sync: open the jaw proportionally to the speaking amplitude.
      if (jaw) {
        const angle = JAW_OPEN_ANGLE * smoothedLevel;
        deltaQuat.setFromAxisAngle(JAW_OPEN_AXIS, angle);
        jaw.bone.quaternion.copy(jaw.rest).multiply(deltaQuat);
      }

      // Idle blink — a quick triangular close/open on a loose cadence.
      if (ENABLE_BLINK && eyelids.length > 0) {
        const phase = (elapsed % BLINK_PERIOD_S) / BLINK_DURATION_S;
        const blink = phase < 1 ? Math.sin(phase * Math.PI) : 0;
        if (blink > 0.001) {
          blinkQuat.setFromAxisAngle(JAW_OPEN_AXIS, BLINK_ANGLE * blink);
          for (const lid of eyelids) lid.bone.quaternion.copy(lid.rest).multiply(blinkQuat);
        } else {
          for (const lid of eyelids) lid.bone.quaternion.copy(lid.rest);
        }
      }

      // Breathing sway + a lean into speech so it reads as alive, not a mannequin.
      avatarGroup.rotation.y = Math.sin(elapsed * 0.35) * 0.05 * motion;
      avatarGroup.position.y = Math.sin(elapsed * 0.8) * 0.01 * motion + smoothedLevel * 0.015;

      // Emissive + bloom breathe with the voice: Ultron lights up when he speaks.
      const glow = 1.4 + smoothedLevel * 1.8 + (speaking ? 0.2 : 0);
      for (const mat of emissiveMaterials) {
        mat.emissiveIntensity += (glow - mat.emissiveIntensity) * 0.2;
      }
      bloomPass.strength += (baseBloom + smoothedLevel * 0.9 - bloomPass.strength) * 0.15;

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
      bloomPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [liveSignalRef]);

  return (
    <div className="relative h-[calc(100vh-9rem)] min-h-[480px] w-full overflow-hidden rounded-lg border border-cyan-300/15 bg-[#02060f]">
      <div ref={hostRef} className="h-full w-full" aria-label="Avatar 3D do Ultron" />

      {/* Cockpit chrome — HUD corners + grid, matching the JARVIS language of the live tab. */}
      <div className="pointer-events-none absolute inset-0">
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

      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center bg-[#02060f]/80">
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
