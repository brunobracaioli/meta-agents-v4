"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { NeuralCoreState } from "./neural-core-state";

type NeuralCoreSceneProps = {
  state: NeuralCoreState;
};

// Mode-driven appearance. Geometry/particle COUNT never depends on mode — only
// these material/light values do, so a mode change mutates in place instead of
// rebuilding the scene (which would tear down the WebGL canvas and flash).
const LOOK = {
  activated: {
    coreColor: 0x9ff6ff,
    coreEmissive: 0x1ec9e8,
    coreEmissiveIntensity: 2.2,
    coreOpacity: 0.92,
    shellOpacity: 0.08,
    lightIntensity: 4.4,
    particleOpacity: 0.72,
    arcOpacity: [0.7, 0.42, 0.5] as const,
  },
  "stand-by": {
    coreColor: 0x356476,
    coreEmissive: 0x12384b,
    coreEmissiveIntensity: 0.72,
    coreOpacity: 0.58,
    shellOpacity: 0.04,
    lightIntensity: 2.2,
    particleOpacity: 0.42,
    arcOpacity: [0.24, 0.16, 0.18] as const,
  },
} as const;

const PARTICLE_COUNT = 340;

type Branch = { branch: THREE.Line; pulse: THREE.Points; node: THREE.Mesh; angle: number };

function makeLine(points: THREE.Vector3[], color: string, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Line(geometry, material);
}

function makeArc(radius: number, color: string, opacity: number, tilt: [number, number, number]) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 72; i += 1) {
    const angle = (i / 72) * Math.PI * 1.35;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.42, Math.sin(angle) * 0.2));
  }
  const arc = makeLine(points, color, opacity);
  arc.rotation.set(tilt[0], tilt[1], tilt[2]);
  return arc;
}

function makeParticles(count: number, radius: number, color: string, size: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = i * 2.399963;
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const jitter = 0.78 + ((i * 37) % 19) / 100;
    positions[i * 3] = Math.cos(theta) * ring * radius * jitter;
    positions[i * 3 + 1] = y * radius * jitter;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius * jitter;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

export function NeuralCoreScene({ state }: NeuralCoreSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // The animation loop reads the latest mode through this ref, so it never holds
  // a stale closure and the loop itself never needs the effect to re-run.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Mutable scene handles, populated once on mount and mutated by the effects below.
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const coreLightRef = useRef<THREE.PointLight | null>(null);
  const shellMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const particlesRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null>(null);
  const arcsRef = useRef<THREE.Line[]>([]);
  const branchesGroupRef = useRef<THREE.Group | null>(null);
  const branchesRef = useRef<Branch[]>([]);
  const branchDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  // Rebuild only the subagent branches when the SET of subagents changes — not on
  // every event. eventCount is excluded so a new event never forces a rebuild.
  const subagentSignature = useMemo(
    () => state.activeSubagents.map((subagent) => `${subagent.name}:${subagent.color}`).join("|"),
    [state.activeSubagents],
  );

  // Mount-only: build the renderer/scene/camera and the animation loop ONCE.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050814, 0.055);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 8.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const initial = LOOK[stateRef.current.mode];

    const disposables: Array<{ dispose: () => void }> = [];
    const neuralGroup = new THREE.Group();
    neuralGroup.position.set(0, 0, 0);
    scene.add(neuralGroup);

    const coreLight = new THREE.PointLight(0x67e8f9, initial.lightIntensity, 16);
    coreLight.position.set(0, 0.1, 1.2);
    neuralGroup.add(coreLight);
    coreLightRef.current = coreLight;
    neuralGroup.add(new THREE.AmbientLight(0x8bd8ff, 0.35));

    const coreGeometry = new THREE.IcosahedronGeometry(1.25, 3);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: initial.coreColor,
      emissive: initial.coreEmissive,
      emissiveIntensity: initial.coreEmissiveIntensity,
      roughness: 0.28,
      metalness: 0.18,
      transparent: true,
      opacity: initial.coreOpacity,
      wireframe: true,
    });
    disposables.push(coreGeometry, coreMaterial);
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    neuralGroup.add(core);
    coreMaterialRef.current = coreMaterial;

    const shellGeometry = new THREE.SphereGeometry(1.85, 48, 24);
    const shellMaterial = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: initial.shellOpacity,
      wireframe: true,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(shellGeometry, shellMaterial);
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    neuralGroup.add(shell);
    shellMaterialRef.current = shellMaterial;

    const particles = makeParticles(PARTICLE_COUNT, 3.6, "#bff7ff", 0.026);
    particles.material.opacity = initial.particleOpacity;
    neuralGroup.add(particles);
    disposables.push(particles.geometry, particles.material);
    particlesRef.current = particles;

    const arcs = [
      makeArc(2.32, "#67e8f9", initial.arcOpacity[0], [0.2, 0.1, 0.2]),
      makeArc(2.72, "#ffffff", initial.arcOpacity[1], [1.2, -0.2, 1.6]),
      makeArc(3.08, "#38bdf8", initial.arcOpacity[2], [-0.8, 0.8, -0.7]),
    ];
    for (const arc of arcs) {
      neuralGroup.add(arc);
      disposables.push(arc.geometry, arc.material as THREE.Material);
    }
    arcsRef.current = arcs;

    const branchesGroup = new THREE.Group();
    neuralGroup.add(branchesGroup);
    branchesGroupRef.current = branchesGroup;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    let raf = 0;
    const render = () => {
      const activated = stateRef.current.mode === "activated";
      const look = LOOK[stateRef.current.mode];
      frame += reducedMotion ? 0.002 : 0.01;
      const activePulse = activated ? 1 : 0.35;
      core.rotation.x = frame * 0.72;
      core.rotation.y = frame * 1.08;
      shell.rotation.y = -frame * 0.34;
      shell.rotation.z = frame * 0.18;
      particles.rotation.y = frame * 0.16;
      particles.rotation.x = Math.sin(frame * 0.7) * 0.08;
      core.scale.setScalar(1 + Math.sin(frame * 3.1) * 0.035 * activePulse);
      coreLight.intensity = look.lightIntensity + Math.sin(frame * 4.2) * activePulse;
      arcs.forEach((arc, index) => {
        arc.rotation.z += reducedMotion ? 0.0005 : 0.0025 + index * 0.0007;
      });
      branchesRef.current.forEach(({ branch, pulse, node, angle }, index) => {
        branch.rotation.y = Math.sin(frame + angle) * 0.04;
        pulse.rotation.y = frame * (0.6 + index * 0.12);
        pulse.scale.setScalar(1 + Math.sin(frame * 2.6 + index) * 0.08);
        node.scale.setScalar(1 + Math.sin(frame * 4.8 + index) * 0.22);
      });
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
      for (const disposable of branchDisposablesRef.current) {
        disposable.dispose();
      }
      branchDisposablesRef.current = [];
      branchesRef.current = [];
      for (const disposable of disposables) {
        disposable.dispose();
      }
      renderer.domElement.remove();
      coreMaterialRef.current = null;
      coreLightRef.current = null;
      shellMaterialRef.current = null;
      particlesRef.current = null;
      arcsRef.current = [];
      branchesGroupRef.current = null;
    };
  }, []);

  // Mode change: mutate materials/light in place — no teardown, so no flash.
  useEffect(() => {
    const look = LOOK[state.mode];
    const coreMaterial = coreMaterialRef.current;
    if (coreMaterial) {
      coreMaterial.color.setHex(look.coreColor);
      coreMaterial.emissive.setHex(look.coreEmissive);
      coreMaterial.emissiveIntensity = look.coreEmissiveIntensity;
      coreMaterial.opacity = look.coreOpacity;
    }
    if (shellMaterialRef.current) {
      shellMaterialRef.current.opacity = look.shellOpacity;
    }
    if (particlesRef.current) {
      particlesRef.current.material.opacity = look.particleOpacity;
    }
    arcsRef.current.forEach((arc, index) => {
      (arc.material as THREE.LineBasicMaterial).opacity = look.arcOpacity[index] ?? 0.2;
    });
  }, [state.mode]);

  // Subagent set change: rebuild ONLY the branches group, leaving the renderer,
  // core, shell, particles and arcs untouched.
  useEffect(() => {
    const group = branchesGroupRef.current;
    if (!group) return;

    for (const disposable of branchDisposablesRef.current) {
      disposable.dispose();
    }
    branchDisposablesRef.current = [];
    for (const child of [...group.children]) {
      group.remove(child);
    }

    const subagents = state.activeSubagents;
    branchesRef.current = subagents.map((subagent, index) => {
      const angle = (index / Math.max(subagents.length, 1)) * Math.PI * 2 + Math.PI / 5;
      const clusterCenter = new THREE.Vector3(Math.cos(angle) * 3.15, Math.sin(angle * 0.7) * 1.15, Math.sin(angle) * 1.15);
      const mid = clusterCenter.clone().multiplyScalar(0.48);
      mid.y += index % 2 === 0 ? 0.72 : -0.54;
      const branch = makeLine([new THREE.Vector3(0, 0, 0), mid, clusterCenter], subagent.color, 0.86);
      const pulse = makeParticles(42, 0.55, subagent.color, 0.04);
      pulse.position.copy(clusterCenter);

      const nodeGeometry = new THREE.SphereGeometry(0.16, 18, 12);
      const nodeMaterial = new THREE.MeshBasicMaterial({
        color: subagent.color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.copy(clusterCenter);

      group.add(branch);
      group.add(pulse);
      group.add(node);
      branchDisposablesRef.current.push(branch.geometry, branch.material as THREE.Material, pulse.geometry, pulse.material, nodeGeometry, nodeMaterial);
      return { branch, pulse, node, angle };
    });
  }, [subagentSignature]);

  return (
    <div
      ref={hostRef}
      className="h-[360px] min-h-[320px] w-full overflow-hidden rounded-lg border border-cyan-200/15 bg-[radial-gradient(circle_at_center,rgba(103,232,249,0.16),rgba(5,8,20,0)_42%),linear-gradient(180deg,rgba(8,18,32,0.82),rgba(2,6,23,0.58))] sm:h-[560px]"
      aria-label={`Neural Core ${state.mode}`}
    />
  );
}
