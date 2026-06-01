"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ActiveSubagent, NeuralCoreState } from "./neural-core-state";

type NeuralCoreSceneProps = {
  state: NeuralCoreState;
};

type Disposable = { dispose: () => void };

type OrganicFiber = {
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
  fiberIndex: number;
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

type SubagentBranch = {
  name: string;
  group: THREE.Group;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lineMaterial: THREE.LineBasicMaterial;
  cluster: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  clusterMaterial: THREE.PointsMaterial;
  terminal: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  terminalMaterial: THREE.PointsMaterial;
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
  synapseNodes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  organicFibers: OrganicFiber[];
  signalFields: SignalField[];
  branchGroup: THREE.Group;
};

type VisualState = {
  standby: number;
  active: number;
  pulse: number;
};

const LOOK = {
  activated: {
    nodeOpacity: 0.82,
    fiberOpacity: 0.5,
    particleOpacity: 0.4,
    speed: 1,
  },
  "stand-by": {
    nodeOpacity: 0.36,
    fiberOpacity: 0.18,
    particleOpacity: 0.18,
    speed: 0.34,
  },
} as const;

const AMBIENT_PARTICLE_COUNT = 360;
const SYNAPSE_NODE_COUNT = 78;
const ORGANIC_FIBER_COUNT = 52;
const ORGANIC_FIBER_SEGMENTS = 90;
const SIGNAL_PARTICLE_COUNT = 96;
const BRANCH_CLUSTER_COUNT = 30;
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
    size: 0.015,
    transparent: true,
    opacity: LOOK["stand-by"].particleOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(geometry, material);
}

function makeSynapseNodes() {
  const pointPositions = new Float32Array(SYNAPSE_NODE_COUNT * 3);

  for (let i = 0; i < SYNAPSE_NODE_COUNT; i += 1) {
    const theta = i * 2.399963;
    const y = 1 - (i / Math.max(SYNAPSE_NODE_COUNT - 1, 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const radius = 0.5 + ((i * 53) % 100) / 96;
    pointPositions[i * 3] = Math.cos(theta) * ring * radius;
    pointPositions[i * 3 + 1] = y * radius * 0.82;
    pointPositions[i * 3 + 2] = Math.sin(theta) * ring * radius;
  }

  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3));
  const nodeMaterial = new THREE.PointsMaterial({
    color: "#dffcff",
    size: 0.055,
    transparent: true,
    opacity: LOOK["stand-by"].nodeOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(nodeGeometry, nodeMaterial);
}

function fiberColor(index: number) {
  if (index % 13 === 0) return "#f59e0b";
  if (index % 8 === 0) return "#f0abfc";
  if (index % 5 === 0) return "#7dd3fc";
  return "#67e8f9";
}

function makeOrganicFibers(): OrganicFiber[] {
  const fibers: OrganicFiber[] = [];

  for (let i = 0; i < ORGANIC_FIBER_COUNT; i += 1) {
    const angle = i * 2.399963;
    const y = 1 - (i / Math.max(ORGANIC_FIBER_COUNT - 1, 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const reach = 2.95 + ((i * 31) % 100) / 70;
    const end = new THREE.Vector3(
      Math.cos(angle) * ring * reach,
      y * 1.58 + Math.sin(angle * 1.7) * 0.34,
      Math.sin(angle) * ring * reach * 0.68,
    );
    const radial = end.clone().normalize();
    const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle * 1.3) * 0.22, Math.cos(angle) * 0.58).normalize();
    const curl = new THREE.Vector3().crossVectors(radial, tangent);
    if (curl.lengthSq() < 0.0001) curl.set(0, 1, 0);
    curl.normalize();

    const controlA = radial.clone().multiplyScalar(0.54 + ((i * 17) % 100) / 310).add(curl.clone().multiplyScalar(0.28));
    const controlB = radial.clone().multiplyScalar(1.26 + ((i * 23) % 100) / 210).add(curl.clone().multiplyScalar(Math.sin(angle) * 0.72));
    const controlC = end.clone().multiplyScalar(0.78).add(curl.clone().multiplyScalar(Math.cos(angle * 0.7) * 0.5));
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), controlA, controlB, controlC, end], false, "catmullrom", 0.62);
    const basePoints = curve.getPoints(ORGANIC_FIBER_SEGMENTS);
    const positions = new Float32Array(basePoints.length * 3);
    const normals: THREE.Vector3[] = [];
    const radials: THREE.Vector3[] = [];

    basePoints.forEach((point, pointIndex) => {
      positions[pointIndex * 3] = point.x;
      positions[pointIndex * 3 + 1] = point.y;
      positions[pointIndex * 3 + 2] = point.z;

      const t = pointIndex / Math.max(basePoints.length - 1, 1);
      const curveTangent = curve.getTangent(t).normalize();
      const pointRadial = point.lengthSq() > 0.0001 ? point.clone().normalize() : radial.clone();
      const normal = new THREE.Vector3().crossVectors(curveTangent, pointRadial);
      if (normal.lengthSq() < 0.0001) normal.copy(curl);
      normals.push(normal.normalize());
      radials.push(pointRadial);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: fiberColor(i),
      transparent: true,
      opacity: LOOK["stand-by"].fiberOpacity * 0.78,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 6;

    fibers.push({
      line,
      geometry,
      material,
      basePoints,
      normals,
      radials,
      phase: angle + ((i * 11) % 100) / 37,
      amplitude: 0.052 + ((i * 7) % 100) / 1450,
      speed: 0.78 + ((i * 19) % 100) / 115,
      baseOpacity: 0.72 + ((i * 29) % 100) / 170,
    });
  }

  return fibers;
}

function makeSignalField(
  fibers: OrganicFiber[],
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
    fiberIndex: fibers.length > 0 ? (index * 7 + routeOffset) % fibers.length : 0,
    offset: ((index * 17 + routeOffset * 11) % 100) / 100,
    speed: 0.34 + ((index * 13 + routeOffset) % 100) / 190,
    phase: index * 0.73 + routeOffset,
    reverse: index % 5 === 0,
  }));

  const points = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 8;

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
  const radial = end.clone().normalize();
  const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle * 0.8) * 0.18, Math.cos(angle) * 0.52).normalize();
  const curl = new THREE.Vector3().crossVectors(radial, tangent);
  if (curl.lengthSq() < 0.0001) curl.set(0, 1, 0);
  curl.normalize();
  const controlA = radial.clone().multiplyScalar(0.7).add(curl.clone().multiplyScalar(0.36));
  const controlB = end.clone().multiplyScalar(0.54).add(curl.clone().multiplyScalar(Math.sin(angle * 1.7) * 0.86));
  const controlC = end.clone().multiplyScalar(0.82).add(tangent.clone().multiplyScalar(0.34));
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), controlA, controlB, controlC, end], false, "catmullrom", 0.64);
  return {
    angle,
    end,
    points: curve.getPoints(58),
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

  // A single bright terminal point marks the synapse forming at the branch tip — a point, not a sphere.
  const terminalGeometry = new THREE.BufferGeometry();
  terminalGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([end.x, end.y, end.z]), 3));
  const terminalMaterial = new THREE.PointsMaterial({
    color: subagent.color,
    size: 0.16,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const terminal = new THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>(terminalGeometry, terminalMaterial);

  const group = new THREE.Group();
  group.scale.setScalar(0.18);
  group.add(branchLine.line);
  group.add(cluster);
  group.add(terminal);

  return {
    name: subagent.name,
    group,
    line: branchLine.line,
    lineMaterial: branchLine.material,
    cluster,
    clusterMaterial,
    terminal,
    terminalMaterial,
    angle,
    createdAt: nowMs,
    eventCount: subagent.eventCount,
    lastEventAt: subagent.lastEventAt,
    pulseStartedAt: nowMs,
    fading: false,
    fadeStartedAt: null,
    disposables: [branchLine.geometry, branchLine.material, clusterGeometry, clusterMaterial, terminalGeometry, terminalMaterial],
  };
}

function setBranchColor(branch: SubagentBranch, color: string) {
  branch.lineMaterial.color.set(color);
  branch.clusterMaterial.color.set(color);
  branch.terminalMaterial.color.set(color);
}

function setBranchOpacity(branch: SubagentBranch, opacity: number, pulse: number) {
  branch.lineMaterial.opacity = 0.62 * opacity + 0.28 * pulse;
  branch.clusterMaterial.opacity = 0.28 * opacity + 0.44 * pulse;
  branch.terminalMaterial.opacity = 0.6 * opacity + 0.32 * pulse;
}

function disposeBranch(branch: SubagentBranch) {
  branch.group.parent?.remove(branch.group);
  for (const disposable of branch.disposables) {
    disposable.dispose();
  }
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
    camera.position.set(0, 0, 7.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.cursor = "grab";
    host.appendChild(renderer.domElement);

    // Drag-to-orbit around the neural core. Rotation only — pan/zoom stay off so the
    // core stays centred and the page scroll/zoom behaviour is untouched.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    // One-finger touch rotates horizontally; vertical finger gestures fall through to page scroll.
    renderer.domElement.style.touchAction = "pan-y";
    const onControlsStart = () => {
      renderer.domElement.style.cursor = "grabbing";
    };
    const onControlsEnd = () => {
      renderer.domElement.style.cursor = "grab";
    };
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("end", onControlsEnd);

    const disposables: Disposable[] = [];
    const neuralGroup = new THREE.Group();
    scene.add(neuralGroup);

    const ambientParticles = makeAmbientParticles();
    neuralGroup.add(ambientParticles);
    disposables.push(ambientParticles.geometry, ambientParticles.material);

    const synapseNodes = makeSynapseNodes();
    neuralGroup.add(synapseNodes);
    disposables.push(synapseNodes.geometry, synapseNodes.material);

    const organicFibers = makeOrganicFibers();
    for (const fiber of organicFibers) {
      neuralGroup.add(fiber.line);
      disposables.push(fiber.geometry, fiber.material);
    }

    const signalFields = [
      makeSignalField(organicFibers, "#e7ffff", SIGNAL_PARTICLE_COUNT, 3, 0.92, 0.24, 0.044),
      makeSignalField(organicFibers, "#f59e0b", Math.floor(SIGNAL_PARTICLE_COUNT * 0.34), 19, 0.52, 0.08, 0.058),
      makeSignalField(organicFibers, "#f0abfc", Math.floor(SIGNAL_PARTICLE_COUNT * 0.24), 31, 0.46, 0.07, 0.052),
    ];
    for (const field of signalFields) {
      neuralGroup.add(field.points);
      disposables.push(field.geometry, field.material);
    }

    const branchGroup = new THREE.Group();
    neuralGroup.add(branchGroup);

    handlesRef.current = {
      neuralGroup,
      ambientParticles,
      synapseNodes,
      organicFibers,
      signalFields,
      branchGroup,
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
      ambientParticles.material.opacity = THREE.MathUtils.lerp(ambientParticles.material.opacity, look.particleOpacity + pulse * 0.06, 0.08);

      synapseNodes.rotation.y = frame * 0.19;
      synapseNodes.rotation.x = Math.sin(frame * 0.5) * 0.08;
      synapseNodes.material.opacity = THREE.MathUtils.lerp(synapseNodes.material.opacity, look.nodeOpacity + pulse * 0.12, 0.08);
      synapseNodes.material.size = THREE.MathUtils.lerp(synapseNodes.material.size, 0.05 + pulse * 0.024, 0.08);

      const organicActivity = 0.34 + visual.active * 0.88 + pulse * 0.62;
      organicFibers.forEach((fiber) => {
        const firstBase = fiber.basePoints[0];
        const firstNormal = fiber.normals[0];
        const firstRadial = fiber.radials[0];
        if (!firstBase || !firstNormal || !firstRadial) return;

        const position = fiber.geometry.getAttribute("position") as THREE.BufferAttribute;
        const maxIndex = Math.max(fiber.basePoints.length - 1, 1);
        for (let pointIndex = 0; pointIndex < fiber.basePoints.length; pointIndex += 1) {
          const base = fiber.basePoints[pointIndex] ?? firstBase;
          const normal = fiber.normals[pointIndex] ?? firstNormal;
          const radial = fiber.radials[pointIndex] ?? firstRadial;
          const progress = pointIndex / maxIndex;
          const falloff = Math.sin(progress * Math.PI);
          const wave = Math.sin(frame * fiber.speed + pointIndex * 0.38 + fiber.phase);
          const shimmer = Math.cos(frame * fiber.speed * 0.57 + pointIndex * 0.17 + fiber.phase * 1.9);
          const amplitude = fiber.amplitude * organicActivity * (0.25 + falloff * 0.85);
          position.setXYZ(
            pointIndex,
            base.x + normal.x * wave * amplitude + radial.x * shimmer * amplitude * 0.24,
            base.y + normal.y * wave * amplitude + radial.y * shimmer * amplitude * 0.24,
            base.z + normal.z * wave * amplitude + radial.z * shimmer * amplitude * 0.24,
          );
        }
        position.needsUpdate = true;
        const fiberOpacity = THREE.MathUtils.clamp(
          0.1 + visual.active * 0.18 + look.fiberOpacity * fiber.baseOpacity * 0.68 + pulse * 0.16,
          0,
          0.72,
        );
        fiber.material.opacity = THREE.MathUtils.lerp(
          fiber.material.opacity,
          fiberOpacity,
          0.08,
        );
      });

      signalFields.forEach((field, fieldIndex) => {
        const position = field.geometry.getAttribute("position") as THREE.BufferAttribute;
        field.routes.forEach((route, particleIndex) => {
          const fiber = organicFibers[route.fiberIndex];
          const firstBase = fiber?.basePoints[0];
          const firstNormal = fiber?.normals[0];
          const firstRadial = fiber?.radials[0];
          if (!fiber || !firstBase || !firstNormal || !firstRadial) return;

          const travelSpeed = route.speed * (0.22 + visual.active * 0.78 + pulse * 0.28);
          const rawProgress = (frame * travelSpeed + route.offset) % 1;
          const progress = route.reverse ? 1 - rawProgress : rawProgress;
          const scaled = progress * Math.max(fiber.basePoints.length - 1, 1);
          const lowerIndex = Math.floor(scaled);
          const upperIndex = Math.min(fiber.basePoints.length - 1, lowerIndex + 1);
          const mix = scaled - lowerIndex;
          const lower = fiber.basePoints[lowerIndex] ?? firstBase;
          const upper = fiber.basePoints[upperIndex] ?? lower;
          const normal = fiber.normals[lowerIndex] ?? firstNormal;
          const radial = fiber.radials[lowerIndex] ?? firstRadial;
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
        const ageMs = nowMs - branch.pulseStartedAt;
        const branchPulse = pulseFromAge(ageMs);
        const fadeProgress = branch.fading && branch.fadeStartedAt !== null ? Math.min(1, (nowMs - branch.fadeStartedAt) / BRANCH_FADE_MS) : 0;
        const emergeProgress = Math.min(1, (nowMs - branch.createdAt) / 900);
        const opacity = (branch.fading ? 1 - fadeProgress : 1) * emergeProgress;

        branch.group.scale.setScalar(THREE.MathUtils.lerp(branch.group.scale.x, 0.96 + branchPulse * 0.08, 0.12));
        branch.group.rotation.y = Math.sin(frame * 0.72 + branch.angle) * 0.035;
        branch.cluster.rotation.y = frame * (0.72 + (branch.angle % 0.4));
        branch.terminalMaterial.size = 0.13 + Math.sin(frame * 4.4 + branch.angle) * 0.02 + branchPulse * 0.12;
        setBranchOpacity(branch, opacity, branchPulse * opacity);

        if (branch.fading && fadeProgress >= 1) {
          disposeBranch(branch);
          branchRegistryRef.current.delete(name);
        }
      }

      controls.update();
      renderer.render(scene, camera);
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
  }, [state.activeSubagents]);

  return (
    <div
      ref={hostRef}
      className="h-[390px] min-h-[340px] w-full overflow-hidden rounded-md bg-[radial-gradient(circle_at_center,rgba(103,232,249,0.2),rgba(56,189,248,0.05)_34%,rgba(2,6,23,0)_68%),linear-gradient(180deg,rgba(4,12,24,0.9),rgba(2,6,23,0.62))] sm:h-[620px]"
      aria-label={`Neural Core ${state.mode}`}
    />
  );
}
