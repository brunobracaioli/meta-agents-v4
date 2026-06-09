"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { ActiveSubagent, NeuralCoreState } from "./neural-core-state";

type NeuralCoreSceneProps = {
  state: NeuralCoreState;
};

type Disposable = { dispose: () => void };

type VisualState = {
  standby: number;
  active: number;
  pulse: number;
};

type EnergyFilament = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  basePoints: THREE.Vector3[];
  normals: THREE.Vector3[];
  radials: THREE.Vector3[];
  phase: number;
  amplitude: number;
  speed: number;
  baseOpacity: number;
};

type SignalRoute = {
  filamentIndex: number;
  offset: number;
  speed: number;
  phase: number;
  reverse: boolean;
};

type SignalField = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  routes: SignalRoute[];
  activeOpacity: number;
  standbyOpacity: number;
  baseSize: number;
};

type DataShell = {
  group: THREE.Group;
  meshMaterial: THREE.MeshBasicMaterial;
  wireMaterial: THREE.LineBasicMaterial;
  phase: number;
  spin: THREE.Vector3;
  baseOpacity: number;
};

type SessionRing = {
  mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  material: THREE.MeshBasicMaterial;
  baseRotation: THREE.Euler;
  baseOpacity: number;
  phase: number;
  speed: number;
};

type OrbitBeam = {
  group: THREE.Group;
  material: THREE.LineBasicMaterial;
  baseOpacity: number;
  phase: number;
  speed: number;
};

type SynapseWeb = {
  line: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
};

type SubagentBranch = {
  name: string;
  group: THREE.Group;
  points: THREE.Vector3[];
  lineMaterial: THREE.LineBasicMaterial;
  cluster: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  clusterMaterial: THREE.PointsMaterial;
  terminalMaterial: THREE.PointsMaterial;
  flowGeometry: THREE.BufferGeometry;
  flowMaterial: THREE.PointsMaterial;
  color: THREE.Color;
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
  branchGroup: THREE.Group;
};

const LOOK = {
  activated: {
    nodeOpacity: 0.66,
    filamentOpacity: 0.4,
    particleOpacity: 0.28,
    shellOpacity: 0.022,
    speed: 1,
  },
  "stand-by": {
    nodeOpacity: 0.24,
    filamentOpacity: 0.1,
    particleOpacity: 0.1,
    shellOpacity: 0.006,
    speed: 0.34,
  },
} as const;

const PULSE_MS = 2200;
const BRANCH_FADE_MS = 1800;
// Arc-reactor look: a clean glowing core inside flat coplanar rings + a coil.
// Counts are deliberately low — the old "hairball" used 520/128/96/72.
const AMBIENT_PARTICLE_COUNT = 150;
const SYNAPSE_NODE_COUNT = 42;
const INTERNAL_LINK_COUNT = 22;
const FILAMENT_COUNT = 14;
const FILAMENT_SEGMENTS = 86;
const SIGNAL_PARTICLE_COUNT = 60;
const COIL_SEGMENT_COUNT = 10;
const COIL_RADIUS = 1.13;
const BRANCH_CLUSTER_COUNT = 34;
const BRANCH_PACKET_COUNT = 8;
const GOLDEN_ANGLE = 2.399963229728653;

function pulseFromAge(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PULSE_MS) return 0;
  const normalized = 1 - ageMs / PULSE_MS;
  return normalized * normalized;
}

function smoothProgress(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
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

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pointInNeuralVolume(index: number, count: number, radiusBase: number, radiusSpread: number): THREE.Vector3 {
  const y = 1 - (index / Math.max(count - 1, 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * GOLDEN_ANGLE;
  const radius = radiusBase + ((index * 47) % 100) / 100 * radiusSpread;
  return new THREE.Vector3(
    Math.cos(theta) * ring * radius,
    y * radius * 0.82,
    Math.sin(theta) * ring * radius * 0.72,
  );
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.18, "rgba(180,250,255,0.82)");
    gradient.addColorStop(0.48, "rgba(34,211,238,0.25)");
    gradient.addColorStop(1, "rgba(34,211,238,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLine(points: THREE.Vector3[], color: THREE.ColorRepresentation, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 8;
  return { line, geometry, material };
}

function makeAmbientParticles(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(AMBIENT_PARTICLE_COUNT * 3);
  for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i += 1) {
    const point = pointInNeuralVolume(i, AMBIENT_PARTICLE_COUNT, 2.35, 1.18);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#bff7ff",
    size: 0.014,
    transparent: true,
    opacity: LOOK["stand-by"].particleOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return points;
}

function makeSynapseNodes(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(SYNAPSE_NODE_COUNT * 3);
  for (let i = 0; i < SYNAPSE_NODE_COUNT; i += 1) {
    const point = pointInNeuralVolume(i, SYNAPSE_NODE_COUNT, 0.48, 1.02);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#e7ffff",
    size: 0.052,
    transparent: true,
    opacity: LOOK["stand-by"].nodeOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 7;
  return points;
}

function makeSynapseWeb(): SynapseWeb {
  const positions = new Float32Array(INTERNAL_LINK_COUNT * 2 * 3);
  for (let i = 0; i < INTERNAL_LINK_COUNT; i += 1) {
    const from = pointInNeuralVolume(i * 5 + 3, INTERNAL_LINK_COUNT * 5, 0.42, 0.98);
    const to = pointInNeuralVolume(i * 11 + 17, INTERNAL_LINK_COUNT * 11, 0.48, 0.92);
    positions[i * 6] = from.x;
    positions[i * 6 + 1] = from.y;
    positions[i * 6 + 2] = from.z;
    positions[i * 6 + 3] = to.x;
    positions[i * 6 + 4] = to.y;
    positions[i * 6 + 5] = to.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: "#67e8f9",
    transparent: true,
    opacity: 0.13,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 5;
  return { line, geometry, material };
}

// Monochrome ice-cyan palette — the arc reactor reads as one light source.
function filamentColor(index: number): string {
  if (index % 5 === 0) return "#bff7ff";
  if (index % 3 === 0) return "#a5f3fc";
  return "#67e8f9";
}

function makeEnergyFilaments(): EnergyFilament[] {
  const filaments: EnergyFilament[] = [];

  for (let i = 0; i < FILAMENT_COUNT; i += 1) {
    const angle = i * GOLDEN_ANGLE;
    const y = 1 - (i / Math.max(FILAMENT_COUNT - 1, 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const reach = 1.75 + ((i * 31) % 100) / 160;
    const end = new THREE.Vector3(
      Math.cos(angle) * ring * reach,
      y * 1.44 + Math.sin(angle * 1.7) * 0.32,
      Math.sin(angle) * ring * reach * 0.72,
    );
    const radial = end.clone().normalize();
    const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle * 1.3) * 0.22, Math.cos(angle) * 0.62).normalize();
    const curl = new THREE.Vector3().crossVectors(radial, tangent);
    if (curl.lengthSq() < 0.0001) curl.set(0, 1, 0);
    curl.normalize();

    const controlA = radial.clone().multiplyScalar(0.42 + ((i * 17) % 100) / 330).add(curl.clone().multiplyScalar(0.22));
    const controlB = radial.clone().multiplyScalar(1.1 + ((i * 23) % 100) / 230).add(curl.clone().multiplyScalar(Math.sin(angle) * 0.66));
    const controlC = end.clone().multiplyScalar(0.78).add(curl.clone().multiplyScalar(Math.cos(angle * 0.7) * 0.48));
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), controlA, controlB, controlC, end], false, "catmullrom", 0.62);
    const basePoints = curve.getPoints(FILAMENT_SEGMENTS);
    const positions = new Float32Array(basePoints.length * 3);
    const normals: THREE.Vector3[] = [];
    const radials: THREE.Vector3[] = [];

    basePoints.forEach((point, pointIndex) => {
      positions[pointIndex * 3] = point.x;
      positions[pointIndex * 3 + 1] = point.y;
      positions[pointIndex * 3 + 2] = point.z;

      const progress = pointIndex / Math.max(basePoints.length - 1, 1);
      const curveTangent = curve.getTangent(progress).normalize();
      const pointRadial = point.lengthSq() > 0.0001 ? point.clone().normalize() : radial.clone();
      const normal = new THREE.Vector3().crossVectors(curveTangent, pointRadial);
      if (normal.lengthSq() < 0.0001) normal.copy(curl);
      normals.push(normal.normalize());
      radials.push(pointRadial);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: filamentColor(i),
      transparent: true,
      opacity: LOOK["stand-by"].filamentOpacity * 0.78,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 6;

    filaments.push({
      line,
      geometry,
      material,
      basePoints,
      normals,
      radials,
      phase: angle + ((i * 11) % 100) / 37,
      amplitude: 0.045 + ((i * 7) % 100) / 1500,
      speed: 0.74 + ((i * 19) % 100) / 118,
      baseOpacity: 0.72 + ((i * 29) % 100) / 170,
    });
  }

  return filaments;
}

function makeSignalField(
  filaments: EnergyFilament[],
  color: THREE.ColorRepresentation,
  count: number,
  routeOffset: number,
  activeOpacity: number,
  standbyOpacity: number,
  baseSize: number,
): SignalField {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size: baseSize,
    transparent: true,
    opacity: standbyOpacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const routes = Array.from({ length: count }, (_, index): SignalRoute => ({
    filamentIndex: filaments.length > 0 ? (index * 7 + routeOffset) % filaments.length : 0,
    offset: ((index * 17 + routeOffset * 11) % 100) / 100,
    speed: 0.34 + ((index * 13 + routeOffset) % 100) / 190,
    phase: index * 0.73 + routeOffset,
    reverse: index % 5 === 0,
  }));

  const points = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;

  return {
    points,
    geometry,
    material,
    routes,
    activeOpacity,
    standbyOpacity,
    baseSize,
  };
}

function makeDataShell(radius: number, color: string, baseOpacity: number, phase: number): { shell: DataShell; disposables: Disposable[] } {
  const group = new THREE.Group();
  const geometry = new THREE.IcosahedronGeometry(radius, 3);
  const meshMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: baseOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>(geometry, meshMaterial);
  mesh.renderOrder = 1;

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);
  const wireMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: baseOpacity * 4,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const wire = new THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>(edgeGeometry, wireMaterial);
  wire.renderOrder = 3;
  group.add(mesh);
  group.add(wire);

  return {
    shell: {
      group,
      meshMaterial,
      wireMaterial,
      phase,
      spin: new THREE.Vector3(0.012 + phase * 0.003, 0.018 + phase * 0.004, 0.009 + phase * 0.002),
      baseOpacity,
    },
    disposables: [geometry, meshMaterial, edgeGeometry, wireMaterial],
  };
}

function makeSessionRing(radius: number, tube: number, color: string, rotation: THREE.Euler, phase: number): {
  ring: SessionRing;
  disposables: Disposable[];
} {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 160);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>(geometry, material);
  mesh.rotation.copy(rotation);
  mesh.renderOrder = 9;
  return {
    ring: {
      mesh,
      material,
      baseRotation: rotation.clone(),
      baseOpacity: 0.34,
      phase,
      speed: 0.12 + phase * 0.04,
    },
    disposables: [geometry, material],
  };
}

function makeOrbitBeam(index: number): { beam: OrbitBeam; disposables: Disposable[] } {
  const points: THREE.Vector3[] = [];
  const radiusX = 2.04 + index * 0.28;
  const radiusZ = 0.86 + index * 0.16;
  const lift = 0.12 + index * 0.03;
  for (let i = 0; i <= 160; i += 1) {
    const progress = i / 160;
    const angle = progress * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radiusX, Math.sin(angle * 2 + index) * lift, Math.sin(angle) * radiusZ));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: index % 2 === 0 ? "#a5f3fc" : "#67e8f9",
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 4;

  const group = new THREE.Group();
  group.rotation.set(index * 0.42, index * 0.74, index * 0.31);
  group.add(line);

  return {
    beam: {
      group,
      material,
      baseOpacity: 0.18 + index * 0.018,
      phase: index * 0.77,
      speed: 0.07 + index * 0.015,
    },
    disposables: [geometry, material],
  };
}

// The iconic Stark-reactor coil: flat ring of rectangular windings facing the
// camera, sitting between the inner and outer session rings.
function makeReactorCoil(): { group: THREE.Group; material: THREE.MeshBasicMaterial; disposables: Disposable[] } {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: "#9beefc",
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.BoxGeometry(0.34, 0.14, 0.05);
  for (let i = 0; i < COIL_SEGMENT_COUNT; i += 1) {
    const angle = (i / COIL_SEGMENT_COUNT) * Math.PI * 2;
    const segment = new THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>(geometry, material);
    segment.position.set(Math.cos(angle) * COIL_RADIUS, Math.sin(angle) * COIL_RADIUS, 0);
    segment.rotation.z = angle + Math.PI / 2;
    segment.renderOrder = 9;
    group.add(segment);
  }
  return { group, material, disposables: [geometry, material] };
}

function branchEndpoint(name: string): { angle: number; end: THREE.Vector3 } {
  const hash = hashName(name);
  const angle = ((hash % 1000) / 1000) * Math.PI * 2;
  const lift = ((((hash >>> 10) % 100) / 100) - 0.5) * 1.42;
  return {
    angle,
    end: new THREE.Vector3(Math.cos(angle) * 3.05, lift, Math.sin(angle) * 1.48),
  };
}

function makeBranchPoints(name: string): { angle: number; end: THREE.Vector3; points: THREE.Vector3[] } {
  const { angle, end } = branchEndpoint(name);
  const radial = end.clone().normalize();
  const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle * 0.8) * 0.18, Math.cos(angle) * 0.54).normalize();
  const curl = new THREE.Vector3().crossVectors(radial, tangent);
  if (curl.lengthSq() < 0.0001) curl.set(0, 1, 0);
  curl.normalize();
  const controlA = radial.clone().multiplyScalar(0.62).add(curl.clone().multiplyScalar(0.34));
  const controlB = end.clone().multiplyScalar(0.52).add(curl.clone().multiplyScalar(Math.sin(angle * 1.7) * 0.8));
  const controlC = end.clone().multiplyScalar(0.82).add(tangent.clone().multiplyScalar(0.32));
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), controlA, controlB, controlC, end], false, "catmullrom", 0.64);
  return {
    angle,
    end,
    points: curve.getPoints(64),
  };
}

function makeClusterPositions(center: THREE.Vector3, count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = i * GOLDEN_ANGLE;
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const radius = 0.23 + ((i * 19) % 100) / 540;
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
    size: 0.036,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cluster = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(clusterGeometry, clusterMaterial);
  cluster.frustumCulled = false;
  cluster.renderOrder = 11;

  const terminalGeometry = new THREE.BufferGeometry();
  terminalGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([end.x, end.y, end.z]), 3));
  const terminalMaterial = new THREE.PointsMaterial({
    color: subagent.color,
    size: 0.15,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const terminal = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(terminalGeometry, terminalMaterial);
  terminal.frustumCulled = false;
  terminal.renderOrder = 12;

  const flowGeometry = new THREE.BufferGeometry();
  flowGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BRANCH_PACKET_COUNT * 3), 3));
  const flowMaterial = new THREE.PointsMaterial({
    color: subagent.color,
    size: 0.07,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const flow = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(flowGeometry, flowMaterial);
  flow.frustumCulled = false;
  flow.renderOrder = 13;

  const group = new THREE.Group();
  group.scale.setScalar(0.18);
  group.add(branchLine.line);
  group.add(cluster);
  group.add(terminal);
  group.add(flow);

  return {
    name: subagent.name,
    group,
    points,
    lineMaterial: branchLine.material,
    cluster,
    clusterMaterial,
    terminalMaterial,
    flowGeometry,
    flowMaterial,
    color: new THREE.Color(subagent.color),
    angle,
    createdAt: nowMs,
    eventCount: subagent.eventCount,
    lastEventAt: subagent.lastEventAt,
    pulseStartedAt: nowMs,
    fading: false,
    fadeStartedAt: null,
    disposables: [
      branchLine.geometry,
      branchLine.material,
      clusterGeometry,
      clusterMaterial,
      terminalGeometry,
      terminalMaterial,
      flowGeometry,
      flowMaterial,
    ],
  };
}

function disposeBranch(branch: SubagentBranch): void {
  branch.group.parent?.remove(branch.group);
  for (const disposable of branch.disposables) {
    disposable.dispose();
  }
}

function setInterpolatedPosition(
  attribute: THREE.BufferAttribute,
  index: number,
  points: THREE.Vector3[],
  progress: number,
  offset: THREE.Vector3,
): void {
  const first = points[0];
  if (!first) {
    attribute.setXYZ(index, 0, 0, 0);
    return;
  }
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);
  const scaled = clamped * Math.max(points.length - 1, 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(points.length - 1, lowerIndex + 1);
  const mix = scaled - lowerIndex;
  const lower = points[lowerIndex] ?? first;
  const upper = points[upperIndex] ?? lower;
  attribute.setXYZ(
    index,
    THREE.MathUtils.lerp(lower.x, upper.x, mix) + offset.x,
    THREE.MathUtils.lerp(lower.y, upper.y, mix) + offset.y,
    THREE.MathUtils.lerp(lower.z, upper.z, mix) + offset.z,
  );
}

function updateBranchFlow(branch: SubagentBranch, frame: number, opacity: number): void {
  const attribute = branch.flowGeometry.getAttribute("position") as THREE.BufferAttribute;
  const direction = branch.fading ? -1 : 1;
  for (let i = 0; i < BRANCH_PACKET_COUNT; i += 1) {
    const raw = frame * 0.24 * direction + i / BRANCH_PACKET_COUNT + branch.angle * 0.13;
    const wrapped = ((raw % 1) + 1) % 1;
    const progress = branch.fading ? 1 - wrapped : wrapped;
    const flare = Math.sin(frame * 2.8 + i + branch.angle) * 0.018 * opacity;
    setInterpolatedPosition(attribute, i, branch.points, progress, new THREE.Vector3(flare, flare * 0.35, -flare * 0.2));
  }
  attribute.needsUpdate = true;
}

function setBranchOpacity(branch: SubagentBranch, opacity: number, pulse: number): void {
  branch.lineMaterial.opacity = 0.54 * opacity + 0.26 * pulse;
  branch.clusterMaterial.opacity = 0.24 * opacity + 0.46 * pulse;
  branch.terminalMaterial.opacity = 0.58 * opacity + 0.34 * pulse;
  branch.flowMaterial.opacity = 0.4 * opacity + 0.36 * pulse;
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
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.05);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 5.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.cursor = "grab";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
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
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.48, 0.68);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    const disposables: Disposable[] = [];
    const neuralGroup = new THREE.Group();
    scene.add(neuralGroup);

    const glowTexture = makeGlowTexture();
    const coreGroup = new THREE.Group();
    const coreGeometry = new THREE.SphereGeometry(0.34, 32, 16);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: "#bffaff",
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>(coreGeometry, coreMaterial);
    const coreWireGeometry = new THREE.IcosahedronGeometry(0.62, 2);
    const coreWireMaterial = new THREE.MeshBasicMaterial({
      color: "#67e8f9",
      wireframe: true,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreWire = new THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>(coreWireGeometry, coreWireMaterial);
    const coreGlowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: "#67e8f9",
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreGlow = new THREE.Sprite(coreGlowMaterial);
    coreGlow.scale.set(2.18, 2.18, 1);
    coreGroup.add(coreGlow);
    coreGroup.add(core);
    coreGroup.add(coreWire);
    neuralGroup.add(coreGroup);
    disposables.push(glowTexture, coreGeometry, coreMaterial, coreWireGeometry, coreWireMaterial, coreGlowMaterial);

    const shells: DataShell[] = [];
    [
      makeDataShell(1.26, "#67e8f9", 0.004, 0.2),
    ].forEach(({ shell, disposables: shellDisposables }) => {
      shells.push(shell);
      neuralGroup.add(shell.group);
      disposables.push(...shellDisposables);
    });

    const ambientParticles = makeAmbientParticles();
    neuralGroup.add(ambientParticles);
    disposables.push(ambientParticles.geometry, ambientParticles.material);

    const synapseWeb = makeSynapseWeb();
    neuralGroup.add(synapseWeb.line);
    disposables.push(synapseWeb.geometry, synapseWeb.material);

    const synapseNodes = makeSynapseNodes();
    neuralGroup.add(synapseNodes);
    disposables.push(synapseNodes.geometry, synapseNodes.material);

    const filaments = makeEnergyFilaments();
    for (const filament of filaments) {
      neuralGroup.add(filament.line);
      disposables.push(filament.geometry, filament.material);
    }

    const signalFields = [
      makeSignalField(filaments, "#e7ffff", SIGNAL_PARTICLE_COUNT, 3, 0.85, 0.2, 0.044),
    ];
    for (const field of signalFields) {
      neuralGroup.add(field.points);
      disposables.push(field.geometry, field.material);
    }

    // Flat, coplanar rings facing the camera — the reactor housing.
    const sessionRings: SessionRing[] = [];
    [
      makeSessionRing(0.92, 0.014, "#67e8f9", new THREE.Euler(0, 0, 0), 0.2),
      makeSessionRing(1.34, 0.009, "#a5f3fc", new THREE.Euler(0, 0, 1.1), 0.7),
      makeSessionRing(1.62, 0.006, "#67e8f9", new THREE.Euler(0, 0, 2.2), 1.1),
    ].forEach(({ ring, disposables: ringDisposables }) => {
      sessionRings.push(ring);
      neuralGroup.add(ring.mesh);
      disposables.push(...ringDisposables);
    });

    const reactorCoil = makeReactorCoil();
    neuralGroup.add(reactorCoil.group);
    disposables.push(...reactorCoil.disposables);

    const orbitBeams: OrbitBeam[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { beam, disposables: beamDisposables } = makeOrbitBeam(i);
      orbitBeams.push(beam);
      neuralGroup.add(beam.group);
      disposables.push(...beamDisposables);
    }

    const branchGroup = new THREE.Group();
    neuralGroup.add(branchGroup);
    handlesRef.current = { branchGroup };

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
    let frame = 0;
    let raf = 0;

    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.033);
      const nowMs = Date.now();
      const visual = getVisualState(stateRef.current, nowMs);
      const look = LOOK[stateRef.current.mode];
      const motionScale = reducedMotion ? 0.32 : 1;
      const pulse = visual.pulse;
      const activity = 0.28 + visual.active * 0.9 + pulse * 0.56;
      frame += dt * motionScale * (0.44 + look.speed + pulse * 0.22);

      // Bounded sway (no full revolution): the reactor housing must keep facing
      // the viewer; OrbitControls still allows manual orbiting.
      neuralGroup.rotation.y = Math.sin(frame * 0.12) * 0.16;
      neuralGroup.rotation.x = Math.sin(frame * 0.09) * 0.06;
      neuralGroup.rotation.z = Math.cos(frame * 0.07) * 0.032;

      coreGroup.scale.setScalar(1 + visual.active * 0.055 + pulse * 0.09 + Math.sin(frame * 3.1) * 0.012);
      core.rotation.y = frame * 0.8;
      coreWire.rotation.x = frame * 0.32;
      coreWire.rotation.y = -frame * 0.48;
      coreMaterial.opacity = THREE.MathUtils.lerp(coreMaterial.opacity, 0.28 + visual.active * 0.22 + pulse * 0.18, 0.08);
      coreWireMaterial.opacity = THREE.MathUtils.lerp(coreWireMaterial.opacity, 0.22 + visual.active * 0.3 + pulse * 0.22, 0.08);
      coreGlowMaterial.opacity = THREE.MathUtils.lerp(coreGlowMaterial.opacity, 0.42 + visual.active * 0.32 + pulse * 0.24, 0.08);
      const glowScale = 2.0 + visual.active * 0.3 + pulse * 0.56 + Math.sin(frame * 2.4) * 0.08;
      coreGlow.scale.set(glowScale, glowScale, 1);

      ambientParticles.rotation.y = frame * 0.065;
      ambientParticles.rotation.x = Math.sin(frame * 0.34) * 0.045;
      ambientParticles.material.opacity = THREE.MathUtils.lerp(
        ambientParticles.material.opacity,
        look.particleOpacity + pulse * 0.06,
        0.08,
      );

      synapseWeb.line.rotation.y = -frame * 0.13;
      synapseWeb.line.rotation.x = Math.sin(frame * 0.26) * 0.055;
      synapseWeb.material.opacity = THREE.MathUtils.lerp(synapseWeb.material.opacity, 0.05 + visual.active * 0.12 + pulse * 0.1, 0.08);

      synapseNodes.rotation.y = frame * 0.19;
      synapseNodes.rotation.x = Math.sin(frame * 0.5) * 0.08;
      synapseNodes.material.opacity = THREE.MathUtils.lerp(synapseNodes.material.opacity, look.nodeOpacity + pulse * 0.12, 0.08);
      synapseNodes.material.size = THREE.MathUtils.lerp(synapseNodes.material.size, 0.049 + visual.active * 0.01 + pulse * 0.024, 0.08);

      shells.forEach((shell, index) => {
        shell.group.rotation.x += shell.spin.x * motionScale;
        shell.group.rotation.y += shell.spin.y * motionScale;
        shell.group.rotation.z += shell.spin.z * motionScale;
        const shellPulse = Math.sin(frame * (0.7 + index * 0.14) + shell.phase) * 0.014;
        shell.group.scale.setScalar(1 + shellPulse + pulse * 0.025);
        const shellOpacity = look.shellOpacity * (1 + index * 0.16) + pulse * 0.022;
        shell.meshMaterial.opacity = THREE.MathUtils.lerp(shell.meshMaterial.opacity, shell.baseOpacity + shellOpacity * 0.32, 0.08);
        shell.wireMaterial.opacity = THREE.MathUtils.lerp(shell.wireMaterial.opacity, shellOpacity * 2.2, 0.08);
      });

      // Reactor rings spin in-plane (alternating directions) with only a gentle
      // 3D wobble, so the housing keeps facing the viewer.
      sessionRings.forEach((ring, index) => {
        ring.mesh.rotation.set(
          ring.baseRotation.x + Math.sin(frame * ring.speed + ring.phase) * 0.07,
          ring.baseRotation.y + Math.cos(frame * ring.speed * 0.8 + ring.phase) * 0.07,
          ring.baseRotation.z + frame * (0.16 + index * 0.06) * (index % 2 === 0 ? 1 : -1),
        );
        const targetOpacity = ring.baseOpacity * (0.4 + visual.active * 1.1) + pulse * 0.14;
        ring.material.opacity = THREE.MathUtils.lerp(ring.material.opacity, targetOpacity, 0.08);
        const scale = 1 + visual.active * 0.03 + pulse * 0.08 + Math.sin(frame * 1.2 + ring.phase) * 0.012;
        ring.mesh.scale.setScalar(scale);
      });

      reactorCoil.group.rotation.z = -frame * 0.2;
      reactorCoil.group.rotation.x = Math.sin(frame * 0.21) * 0.05;
      reactorCoil.material.opacity = THREE.MathUtils.lerp(
        reactorCoil.material.opacity,
        0.18 + visual.active * 0.34 + pulse * 0.2,
        0.08,
      );

      orbitBeams.forEach((beam, index) => {
        beam.group.rotation.x += Math.sin(beam.phase + frame * 0.4) * 0.0008 * motionScale;
        beam.group.rotation.y += beam.speed * motionScale;
        beam.group.rotation.z += (0.012 + index * 0.002) * motionScale;
        beam.material.opacity = THREE.MathUtils.lerp(
          beam.material.opacity,
          beam.baseOpacity * (0.28 + visual.active * 1.2) + pulse * 0.08,
          0.08,
        );
      });

      filaments.forEach((filament) => {
        const firstBase = filament.basePoints[0];
        const firstNormal = filament.normals[0];
        const firstRadial = filament.radials[0];
        if (!firstBase || !firstNormal || !firstRadial) return;

        const position = filament.geometry.getAttribute("position") as THREE.BufferAttribute;
        const maxIndex = Math.max(filament.basePoints.length - 1, 1);
        for (let pointIndex = 0; pointIndex < filament.basePoints.length; pointIndex += 1) {
          const base = filament.basePoints[pointIndex] ?? firstBase;
          const normal = filament.normals[pointIndex] ?? firstNormal;
          const radial = filament.radials[pointIndex] ?? firstRadial;
          const progress = pointIndex / maxIndex;
          const falloff = Math.sin(progress * Math.PI);
          const wave = Math.sin(frame * filament.speed + pointIndex * 0.38 + filament.phase);
          const shimmer = Math.cos(frame * filament.speed * 0.57 + pointIndex * 0.17 + filament.phase * 1.9);
          const amplitude = filament.amplitude * activity * (0.25 + falloff * 0.85);
          position.setXYZ(
            pointIndex,
            base.x + normal.x * wave * amplitude + radial.x * shimmer * amplitude * 0.24,
            base.y + normal.y * wave * amplitude + radial.y * shimmer * amplitude * 0.24,
            base.z + normal.z * wave * amplitude + radial.z * shimmer * amplitude * 0.24,
          );
        }
        position.needsUpdate = true;
        const filamentOpacity = THREE.MathUtils.clamp(
          0.08 + visual.active * 0.18 + look.filamentOpacity * filament.baseOpacity * 0.68 + pulse * 0.16,
          0,
          0.76,
        );
        filament.material.opacity = THREE.MathUtils.lerp(filament.material.opacity, filamentOpacity, 0.08);
      });

      signalFields.forEach((field, fieldIndex) => {
        const position = field.geometry.getAttribute("position") as THREE.BufferAttribute;
        field.routes.forEach((route, particleIndex) => {
          const filament = filaments[route.filamentIndex];
          const firstBase = filament?.basePoints[0];
          const firstNormal = filament?.normals[0];
          const firstRadial = filament?.radials[0];
          if (!filament || !firstBase || !firstNormal || !firstRadial) return;

          const travelSpeed = route.speed * (0.22 + visual.active * 0.78 + pulse * 0.28);
          const rawProgress = (frame * travelSpeed + route.offset) % 1;
          const progress = route.reverse ? 1 - rawProgress : rawProgress;
          const scaled = progress * Math.max(filament.basePoints.length - 1, 1);
          const lowerIndex = Math.floor(scaled);
          const upperIndex = Math.min(filament.basePoints.length - 1, lowerIndex + 1);
          const mix = scaled - lowerIndex;
          const lower = filament.basePoints[lowerIndex] ?? firstBase;
          const upper = filament.basePoints[upperIndex] ?? lower;
          const normal = filament.normals[lowerIndex] ?? firstNormal;
          const radial = filament.radials[lowerIndex] ?? firstRadial;
          const wave = Math.sin(frame * (1.4 + fieldIndex * 0.22) + route.phase + progress * 8.6);
          const spark = 0.045 + visual.active * 0.055 + pulse * 0.04;

          position.setXYZ(
            particleIndex,
            THREE.MathUtils.lerp(lower.x, upper.x, mix) + normal.x * wave * spark + radial.x * spark * 0.18,
            THREE.MathUtils.lerp(lower.y, upper.y, mix) + normal.y * wave * spark + radial.y * spark * 0.18,
            THREE.MathUtils.lerp(lower.z, upper.z, mix) + normal.z * wave * spark + radial.z * spark * 0.18,
          );
        });
        position.needsUpdate = true;
        field.material.opacity = THREE.MathUtils.lerp(
          field.material.opacity,
          THREE.MathUtils.clamp(field.standbyOpacity + visual.active * (field.activeOpacity - field.standbyOpacity) + pulse * 0.22, 0, 1),
          0.08,
        );
        field.material.size = THREE.MathUtils.lerp(field.material.size, field.baseSize + visual.active * 0.018 + pulse * 0.028, 0.08);
      });

      for (const [name, branch] of [...branchRegistryRef.current.entries()]) {
        const branchPulse = pulseFromAge(nowMs - branch.pulseStartedAt);
        const fadeProgress = branch.fading && branch.fadeStartedAt !== null ? Math.min(1, (nowMs - branch.fadeStartedAt) / BRANCH_FADE_MS) : 0;
        const emergeProgress = smoothProgress((nowMs - branch.createdAt) / 900);
        const opacity = (branch.fading ? 1 - fadeProgress : 1) * emergeProgress;
        const collapse = branch.fading ? 1 - fadeProgress * 0.72 : 1;
        const color = branch.color.clone().lerp(new THREE.Color("#fb7185"), fadeProgress * 0.85);

        branch.lineMaterial.color.copy(color);
        branch.clusterMaterial.color.copy(color);
        branch.terminalMaterial.color.copy(color);
        branch.flowMaterial.color.copy(color);
        branch.group.scale.setScalar(THREE.MathUtils.lerp(branch.group.scale.x, (0.96 + branchPulse * 0.08) * collapse, 0.12));
        branch.group.rotation.y = Math.sin(frame * 0.72 + branch.angle) * 0.035;
        branch.cluster.rotation.y = frame * (0.72 + (branch.angle % 0.4));
        branch.terminalMaterial.size = 0.13 + Math.sin(frame * 4.4 + branch.angle) * 0.02 + branchPulse * 0.12;
        branch.flowMaterial.size = 0.052 + branchPulse * 0.035;
        updateBranchFlow(branch, frame, opacity);
        setBranchOpacity(branch, opacity, branchPulse * opacity);

        if (branch.fading && fadeProgress >= 1) {
          disposeBranch(branch);
          branchRegistryRef.current.delete(name);
        }
      }

      controls.update();
      composer.render();
      raf = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
      controls.dispose();
      for (const branch of branchRegistryRef.current.values()) {
        disposeBranch(branch);
      }
      branchRegistryRef.current.clear();
      for (const disposable of disposables) {
        disposable.dispose();
      }
      bloomPass.dispose();
      composer.dispose();
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

      branch.color.set(subagent.color);
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
  }, [state.activeSubagents]);

  return (
    <div
      ref={hostRef}
      className="h-[390px] min-h-[340px] w-full overflow-hidden rounded-md bg-black sm:h-[620px]"
      aria-label={`Neural Core ${state.mode}`}
    />
  );
}
