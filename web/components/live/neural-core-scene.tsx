"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ActiveSubagent, NeuralCoreState } from "./neural-core-state";

type NeuralCoreSceneProps = {
  state: NeuralCoreState;
};

type Disposable = { dispose: () => void };

type EnergyBeam = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  speed: number;
  baseOpacity: number;
};

type Membrane = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  speed: THREE.Vector3;
  baseOpacity: number;
};

type SubagentBranch = {
  name: string;
  group: THREE.Group;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lineMaterial: THREE.LineBasicMaterial;
  cluster: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  clusterMaterial: THREE.PointsMaterial;
  node: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  nodeMaterial: THREE.MeshBasicMaterial;
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  haloMaterial: THREE.MeshBasicMaterial;
  angle: number;
  createdAt: number;
  eventCount: number;
  lastEventAt: string;
  pulseStartedAt: number;
  fading: boolean;
  fadeStartedAt: number | null;
  disposables: Disposable[];
};

type SceneHandles = {
  neuralGroup: THREE.Group;
  ambientParticles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  synapseLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  synapseNodes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  nucleus: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  nucleusHalo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  nucleusLight: THREE.PointLight;
  membranes: Membrane[];
  beams: EnergyBeam[];
  branchGroup: THREE.Group;
  overflowGroup: THREE.Group;
  overflowPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  overflowRing: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
};

type VisualState = {
  standby: number;
  active: number;
  pulse: number;
};

const LOOK = {
  activated: {
    nucleusOpacity: 0.96,
    haloOpacity: 0.18,
    membraneOpacity: 0.11,
    synapseOpacity: 0.42,
    nodeOpacity: 0.78,
    beamOpacity: 0.62,
    particleOpacity: 0.48,
    lightIntensity: 5.2,
    speed: 1,
  },
  "stand-by": {
    nucleusOpacity: 0.58,
    haloOpacity: 0.07,
    membraneOpacity: 0.045,
    synapseOpacity: 0.16,
    nodeOpacity: 0.34,
    beamOpacity: 0.22,
    particleOpacity: 0.24,
    lightIntensity: 2.2,
    speed: 0.34,
  },
} as const;

const AMBIENT_PARTICLE_COUNT = 420;
const SYNAPSE_NODE_COUNT = 56;
const SYNAPSE_CONNECTION_COUNT = 116;
const BRANCH_CLUSTER_COUNT = 34;
const OVERFLOW_POINT_COUNT = 18;
const PULSE_MS = 2200;
const BRANCH_FADE_MS = 1800;

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pulseFromAge(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PULSE_MS) return 0;
  const normalized = 1 - ageMs / PULSE_MS;
  return normalized * normalized;
}

function getVisualState(state: NeuralCoreState, nowMs: number): VisualState {
  const active = state.mode === "activated" ? 1 : 0;
  const lastEventMs = state.lastEventAt ? Date.parse(state.lastEventAt) : 0;
  return {
    standby: 1 - active,
    active,
    pulse: lastEventMs > 0 ? pulseFromAge(nowMs - lastEventMs) : 0,
  };
}

function makeLine(points: THREE.Vector3[], color: THREE.ColorRepresentation, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return {
    line: new THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>(geometry, material),
    geometry,
    material,
  };
}

function makeAmbientParticles() {
  const positions = new Float32Array(AMBIENT_PARTICLE_COUNT * 3);
  for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i += 1) {
    const theta = i * 2.399963;
    const y = 1 - (i / Math.max(AMBIENT_PARTICLE_COUNT - 1, 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const radius = 2.8 + ((i * 37) % 100) / 100;
    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = y * radius * 0.68;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#bff7ff",
    size: 0.018,
    transparent: true,
    opacity: LOOK["stand-by"].particleOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(geometry, material);
}

function makeSynapseNetwork() {
  const nodePositions: THREE.Vector3[] = [];
  const pointPositions = new Float32Array(SYNAPSE_NODE_COUNT * 3);

  for (let i = 0; i < SYNAPSE_NODE_COUNT; i += 1) {
    const theta = i * 2.399963;
    const y = 1 - (i / Math.max(SYNAPSE_NODE_COUNT - 1, 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const radius = 0.42 + ((i * 53) % 100) / 145;
    const point = new THREE.Vector3(
      Math.cos(theta) * ring * radius,
      y * radius * 0.82,
      Math.sin(theta) * ring * radius,
    );
    nodePositions.push(point);
    pointPositions[i * 3] = point.x;
    pointPositions[i * 3 + 1] = point.y;
    pointPositions[i * 3 + 2] = point.z;
  }

  const linePositions = new Float32Array(SYNAPSE_CONNECTION_COUNT * 2 * 3);
  for (let i = 0; i < SYNAPSE_CONNECTION_COUNT; i += 1) {
    const from = nodePositions[i % SYNAPSE_NODE_COUNT] ?? nodePositions[0];
    const to = nodePositions[(i * 7 + 13) % SYNAPSE_NODE_COUNT] ?? nodePositions[0];
    if (!from || !to) continue;
    linePositions[i * 6] = from.x;
    linePositions[i * 6 + 1] = from.y;
    linePositions[i * 6 + 2] = from.z;
    linePositions[i * 6 + 3] = to.x;
    linePositions[i * 6 + 4] = to.y;
    linePositions[i * 6 + 5] = to.z;
  }

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const lineMaterial = new THREE.LineBasicMaterial({
    color: "#67e8f9",
    transparent: true,
    opacity: LOOK["stand-by"].synapseOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3));
  const nodeMaterial = new THREE.PointsMaterial({
    color: "#dffcff",
    size: 0.052,
    transparent: true,
    opacity: LOOK["stand-by"].nodeOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return {
    lines: new THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>(lineGeometry, lineMaterial),
    nodes: new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(nodeGeometry, nodeMaterial),
  };
}

function makeMembranes(): Membrane[] {
  return [
    { radius: 1.72, opacity: 0.9, scale: new THREE.Vector3(1, 0.82, 1.08), speed: new THREE.Vector3(0.08, -0.15, 0.05) },
    { radius: 2.06, opacity: 0.72, scale: new THREE.Vector3(1.1, 0.96, 0.88), speed: new THREE.Vector3(-0.06, 0.11, -0.08) },
    { radius: 2.38, opacity: 0.52, scale: new THREE.Vector3(0.94, 1.05, 1.16), speed: new THREE.Vector3(0.04, 0.08, 0.1) },
  ].map(({ radius, opacity, scale, speed }) => {
    const geometry = new THREE.SphereGeometry(radius, 64, 32);
    const material = new THREE.MeshBasicMaterial({
      color: "#67e8f9",
      transparent: true,
      opacity: LOOK["stand-by"].membraneOpacity * opacity,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(geometry, material);
    mesh.scale.copy(scale);
    return {
      mesh,
      speed,
      baseOpacity: opacity,
    };
  });
}

function makeEnergyBeam(radius: number, color: THREE.ColorRepresentation, opacity: number, tilt: THREE.Euler, phase: number) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const angle = (i / 120) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle + phase) * radius * 0.2,
        Math.sin(angle) * radius * 0.58,
      ),
    );
  }

  const { line, geometry, material } = makeLine(points, color, opacity);
  line.rotation.copy(tilt);
  return {
    line,
    geometry,
    material,
  };
}

function branchEndpoint(name: string) {
  const hash = hashName(name);
  const angle = ((hash % 1000) / 1000) * Math.PI * 2;
  const lift = ((((hash >>> 10) % 100) / 100) - 0.5) * 1.38;
  return {
    angle,
    end: new THREE.Vector3(Math.cos(angle) * 3.18, lift, Math.sin(angle) * 1.42),
  };
}

function makeBranchPoints(name: string) {
  const { angle, end } = branchEndpoint(name);
  const mid = end.clone().multiplyScalar(0.48);
  mid.y += Math.sin(angle * 1.7) * 0.72;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), mid, end]);
  return {
    angle,
    end,
    points: curve.getPoints(42),
  };
}

function makeClusterPositions(center: THREE.Vector3, count: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = i * 2.399963;
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const radius = 0.24 + ((i * 19) % 100) / 520;
    positions[i * 3] = center.x + Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = center.y + y * radius * 0.72;
    positions[i * 3 + 2] = center.z + Math.sin(theta) * ring * radius;
  }
  return positions;
}

function makeSubagentBranch(subagent: ActiveSubagent, nowMs: number): SubagentBranch {
  const { angle, end, points } = makeBranchPoints(subagent.name);
  const branchLine = makeLine(points, subagent.color, 0);

  const clusterGeometry = new THREE.BufferGeometry();
  clusterGeometry.setAttribute("position", new THREE.BufferAttribute(makeClusterPositions(end, BRANCH_CLUSTER_COUNT), 3));
  const clusterMaterial = new THREE.PointsMaterial({
    color: subagent.color,
    size: 0.035,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cluster = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(clusterGeometry, clusterMaterial);

  const nodeGeometry = new THREE.SphereGeometry(0.12, 20, 12);
  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: subagent.color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const node = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(nodeGeometry, nodeMaterial);
  node.position.copy(end);

  const haloGeometry = new THREE.SphereGeometry(0.31, 24, 14);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: subagent.color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(haloGeometry, haloMaterial);
  halo.position.copy(end);

  const group = new THREE.Group();
  group.scale.setScalar(0.18);
  group.add(branchLine.line);
  group.add(cluster);
  group.add(halo);
  group.add(node);

  return {
    name: subagent.name,
    group,
    line: branchLine.line,
    lineMaterial: branchLine.material,
    cluster,
    clusterMaterial,
    node,
    nodeMaterial,
    halo,
    haloMaterial,
    angle,
    createdAt: nowMs,
    eventCount: subagent.eventCount,
    lastEventAt: subagent.lastEventAt,
    pulseStartedAt: nowMs,
    fading: false,
    fadeStartedAt: null,
    disposables: [branchLine.geometry, branchLine.material, clusterGeometry, clusterMaterial, nodeGeometry, nodeMaterial, haloGeometry, haloMaterial],
  };
}

function setBranchColor(branch: SubagentBranch, color: string) {
  branch.lineMaterial.color.set(color);
  branch.clusterMaterial.color.set(color);
  branch.nodeMaterial.color.set(color);
  branch.haloMaterial.color.set(color);
}

function setBranchOpacity(branch: SubagentBranch, opacity: number, pulse: number) {
  branch.lineMaterial.opacity = 0.62 * opacity + 0.28 * pulse;
  branch.clusterMaterial.opacity = 0.28 * opacity + 0.44 * pulse;
  branch.nodeMaterial.opacity = 0.74 * opacity + 0.22 * pulse;
  branch.haloMaterial.opacity = 0.12 * opacity + 0.3 * pulse;
}

function disposeBranch(branch: SubagentBranch) {
  branch.group.parent?.remove(branch.group);
  for (const disposable of branch.disposables) {
    disposable.dispose();
  }
}

function makeOverflowLayer() {
  const positions = new Float32Array(OVERFLOW_POINT_COUNT * 3);
  for (let i = 0; i < OVERFLOW_POINT_COUNT; i += 1) {
    const angle = (i / OVERFLOW_POINT_COUNT) * Math.PI * 2;
    const radius = 3.72 + (i % 3) * 0.08;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle * 2.4) * 0.32;
    positions[i * 3 + 2] = Math.sin(angle) * radius * 0.43;
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  pointGeometry.setDrawRange(0, 0);
  const pointMaterial = new THREE.PointsMaterial({
    color: "#d8f8ff",
    size: 0.03,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const ringPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.cos(angle) * 3.82, 0, Math.sin(angle) * 1.7));
  }
  const ring = makeLine(ringPoints, "#d8f8ff", 0);

  return {
    points: new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(pointGeometry, pointMaterial),
    ring: ring.line,
    disposables: [pointGeometry, pointMaterial, ring.geometry, ring.material],
  };
}

export function NeuralCoreScene({ state }: NeuralCoreSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const handlesRef = useRef<SceneHandles | null>(null);
  const branchRegistryRef = useRef<Map<string, SubagentBranch>>(new Map());

  stateRef.current = state;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030712, 0.052);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 8.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    host.appendChild(renderer.domElement);

    const disposables: Disposable[] = [];
    const neuralGroup = new THREE.Group();
    scene.add(neuralGroup);

    const ambientLight = new THREE.AmbientLight(0x8bd8ff, 0.28);
    neuralGroup.add(ambientLight);

    const nucleusLight = new THREE.PointLight(0x67e8f9, LOOK["stand-by"].lightIntensity, 17);
    nucleusLight.position.set(0, 0.1, 1.15);
    neuralGroup.add(nucleusLight);

    const ambientParticles = makeAmbientParticles();
    neuralGroup.add(ambientParticles);
    disposables.push(ambientParticles.geometry, ambientParticles.material);

    const membranes = makeMembranes();
    for (const membrane of membranes) {
      neuralGroup.add(membrane.mesh);
      disposables.push(membrane.mesh.geometry, membrane.mesh.material);
    }

    const synapses = makeSynapseNetwork();
    neuralGroup.add(synapses.lines);
    neuralGroup.add(synapses.nodes);
    disposables.push(synapses.lines.geometry, synapses.lines.material, synapses.nodes.geometry, synapses.nodes.material);

    const nucleusGeometry = new THREE.IcosahedronGeometry(1.08, 4);
    const nucleusMaterial = new THREE.MeshStandardMaterial({
      color: 0x9ff6ff,
      emissive: 0x1ec9e8,
      emissiveIntensity: 1.2,
      roughness: 0.22,
      metalness: 0.18,
      transparent: true,
      opacity: LOOK["stand-by"].nucleusOpacity,
      wireframe: true,
    });
    const nucleus = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(nucleusGeometry, nucleusMaterial);
    neuralGroup.add(nucleus);
    disposables.push(nucleusGeometry, nucleusMaterial);

    const haloGeometry = new THREE.SphereGeometry(1.28, 48, 24);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: "#67e8f9",
      transparent: true,
      opacity: LOOK["stand-by"].haloOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const nucleusHalo = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(haloGeometry, haloMaterial);
    neuralGroup.add(nucleusHalo);
    disposables.push(haloGeometry, haloMaterial);

    const beamSpecs = [
      { radius: 2.3, color: "#67e8f9", opacity: 0.82, tilt: new THREE.Euler(0.14, 0.18, 0.24), phase: 0.1, speed: 0.42 },
      { radius: 2.72, color: "#e7ffff", opacity: 0.48, tilt: new THREE.Euler(1.16, -0.16, 1.38), phase: 1.2, speed: -0.31 },
      { radius: 3.08, color: "#38bdf8", opacity: 0.55, tilt: new THREE.Euler(-0.72, 0.76, -0.64), phase: 2.1, speed: 0.24 },
      { radius: 3.38, color: "#9ff6ff", opacity: 0.28, tilt: new THREE.Euler(0.52, -0.6, 0.9), phase: 2.8, speed: -0.18 },
    ];
    const beams = beamSpecs.map((spec) => {
      const beam = makeEnergyBeam(spec.radius, spec.color, LOOK["stand-by"].beamOpacity * spec.opacity, spec.tilt, spec.phase);
      neuralGroup.add(beam.line);
      disposables.push(beam.geometry, beam.material);
      return {
        line: beam.line,
        speed: spec.speed,
        baseOpacity: spec.opacity,
      };
    });

    const branchGroup = new THREE.Group();
    neuralGroup.add(branchGroup);

    const overflowLayer = makeOverflowLayer();
    const overflowGroup = new THREE.Group();
    overflowGroup.add(overflowLayer.ring);
    overflowGroup.add(overflowLayer.points);
    neuralGroup.add(overflowGroup);
    disposables.push(...overflowLayer.disposables);

    handlesRef.current = {
      neuralGroup,
      ambientParticles,
      synapseLines: synapses.lines,
      synapseNodes: synapses.nodes,
      nucleus,
      nucleusHalo,
      nucleusLight,
      membranes,
      beams,
      branchGroup,
      overflowGroup,
      overflowPoints: overflowLayer.points,
      overflowRing: overflowLayer.ring,
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    let raf = 0;

    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.033);
      const nowMs = Date.now();
      const visual = getVisualState(stateRef.current, nowMs);
      const look = LOOK[stateRef.current.mode];
      const motionScale = reducedMotion ? 0.32 : 1;
      const pulse = visual.pulse;
      frame += dt * motionScale * (0.44 + look.speed + pulse * 0.22);

      neuralGroup.rotation.y = Math.sin(frame * 0.12) * 0.08;
      ambientParticles.rotation.y = frame * 0.08;
      ambientParticles.rotation.x = Math.sin(frame * 0.34) * 0.045;
      ambientParticles.material.opacity = THREE.MathUtils.lerp(ambientParticles.material.opacity, look.particleOpacity + pulse * 0.08, 0.08);

      for (const membrane of membranes) {
        membrane.mesh.rotation.x += membrane.speed.x * dt * motionScale * look.speed;
        membrane.mesh.rotation.y += membrane.speed.y * dt * motionScale * look.speed;
        membrane.mesh.rotation.z += membrane.speed.z * dt * motionScale * look.speed;
        membrane.mesh.material.opacity = THREE.MathUtils.lerp(
          membrane.mesh.material.opacity,
          look.membraneOpacity * membrane.baseOpacity + pulse * 0.035,
          0.08,
        );
      }

      synapses.lines.rotation.y = frame * 0.19;
      synapses.lines.rotation.x = Math.sin(frame * 0.5) * 0.08;
      synapses.nodes.rotation.copy(synapses.lines.rotation);
      synapses.lines.material.opacity = THREE.MathUtils.lerp(synapses.lines.material.opacity, look.synapseOpacity + pulse * 0.26, 0.08);
      synapses.nodes.material.opacity = THREE.MathUtils.lerp(synapses.nodes.material.opacity, look.nodeOpacity + pulse * 0.18, 0.08);
      synapses.nodes.material.size = THREE.MathUtils.lerp(synapses.nodes.material.size, 0.052 + pulse * 0.028, 0.08);

      nucleus.rotation.x = frame * 0.74;
      nucleus.rotation.y = frame * 1.02;
      nucleus.scale.setScalar(1 + Math.sin(frame * 3.1) * 0.025 * (visual.active + pulse));
      nucleus.material.opacity = THREE.MathUtils.lerp(nucleus.material.opacity, look.nucleusOpacity + pulse * 0.04, 0.08);
      nucleus.material.emissiveIntensity = THREE.MathUtils.lerp(nucleus.material.emissiveIntensity, 1.25 + visual.active * 1.25 + pulse * 1.1, 0.08);
      nucleusHalo.scale.setScalar(1.02 + pulse * 0.12 + Math.sin(frame * 2.2) * 0.018);
      nucleusHalo.material.opacity = THREE.MathUtils.lerp(nucleusHalo.material.opacity, look.haloOpacity + pulse * 0.16, 0.08);
      nucleusLight.intensity = THREE.MathUtils.lerp(nucleusLight.intensity, look.lightIntensity + pulse * 2.4, 0.08);

      beams.forEach((beam, index) => {
        beam.line.rotation.z += beam.speed * dt * motionScale * (0.72 + visual.active * 0.5);
        beam.line.rotation.y += beam.speed * dt * motionScale * 0.18;
        beam.line.material.opacity = THREE.MathUtils.lerp(
          beam.line.material.opacity,
          look.beamOpacity * beam.baseOpacity + pulse * (0.08 + index * 0.018),
          0.08,
        );
      });

      handlesRef.current?.overflowGroup.rotation.set(Math.sin(frame * 0.22) * 0.08, frame * 0.11, 0);

      for (const [name, branch] of [...branchRegistryRef.current.entries()]) {
        const ageMs = nowMs - branch.pulseStartedAt;
        const branchPulse = pulseFromAge(ageMs);
        const fadeProgress = branch.fading && branch.fadeStartedAt !== null ? Math.min(1, (nowMs - branch.fadeStartedAt) / BRANCH_FADE_MS) : 0;
        const emergeProgress = Math.min(1, (nowMs - branch.createdAt) / 900);
        const opacity = (branch.fading ? 1 - fadeProgress : 1) * emergeProgress;

        branch.group.scale.setScalar(THREE.MathUtils.lerp(branch.group.scale.x, 0.96 + branchPulse * 0.08, 0.12));
        branch.group.rotation.y = Math.sin(frame * 0.72 + branch.angle) * 0.035;
        branch.cluster.rotation.y = frame * (0.72 + (branch.angle % 0.4));
        branch.node.scale.setScalar(1 + Math.sin(frame * 4.4 + branch.angle) * 0.16 + branchPulse * 0.5);
        branch.halo.scale.setScalar(1 + branchPulse * 0.8);
        setBranchOpacity(branch, opacity, branchPulse * opacity);

        if (branch.fading && fadeProgress >= 1) {
          disposeBranch(branch);
          branchRegistryRef.current.delete(name);
        }
      }

      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      for (const branch of branchRegistryRef.current.values()) {
        disposeBranch(branch);
      }
      branchRegistryRef.current.clear();
      for (const disposable of disposables) {
        disposable.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      handlesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;

    const nowMs = Date.now();
    const activeNames = new Set<string>();

    state.activeSubagents.forEach((subagent) => {
      activeNames.add(subagent.name);
      let branch = branchRegistryRef.current.get(subagent.name);
      if (!branch) {
        branch = makeSubagentBranch(subagent, nowMs);
        handles.branchGroup.add(branch.group);
        branchRegistryRef.current.set(subagent.name, branch);
      }

      setBranchColor(branch, subagent.color);
      if (branch.lastEventAt !== subagent.lastEventAt || branch.eventCount !== subagent.eventCount) {
        branch.lastEventAt = subagent.lastEventAt;
        branch.eventCount = subagent.eventCount;
        branch.pulseStartedAt = nowMs;
      }
      branch.fading = false;
      branch.fadeStartedAt = null;
    });

    for (const branch of branchRegistryRef.current.values()) {
      if (!activeNames.has(branch.name) && !branch.fading) {
        branch.fading = true;
        branch.fadeStartedAt = nowMs;
      }
    }

    const overflowVisible = Math.min(OVERFLOW_POINT_COUNT, Math.max(0, state.overflowSubagentCount * 3));
    handles.overflowPoints.geometry.setDrawRange(0, overflowVisible);
    handles.overflowPoints.material.opacity = state.overflowSubagentCount > 0 ? 0.22 : 0;
    handles.overflowRing.material.opacity = state.overflowSubagentCount > 0 ? 0.12 : 0;
  }, [state.activeSubagents, state.overflowSubagentCount]);

  return (
    <div
      ref={hostRef}
      className="h-[390px] min-h-[340px] w-full overflow-hidden rounded-md bg-[radial-gradient(circle_at_center,rgba(103,232,249,0.2),rgba(56,189,248,0.05)_34%,rgba(2,6,23,0)_68%),linear-gradient(180deg,rgba(4,12,24,0.9),rgba(2,6,23,0.62))] sm:h-[620px]"
      aria-label={`Neural Core ${state.mode}`}
    />
  );
}
