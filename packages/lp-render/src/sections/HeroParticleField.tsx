"use client";

import { useEffect, useRef } from "react";
// three is DYNAMICALLY imported inside the effect (see Stage3D.tsx) so it stays out of the
// initial bundle and never evaluates during SSR/static export. A type-only import keeps the
// THREE.* type annotations without emitting a runtime dependency.
import type * as THREE from "three";

/**
 * Interactive particle WAVE for the hero background (Three.js / WebGL).
 *
 * Ported from claude-code.b2tech.io (`src/components/lp/hero-particle-field.tsx`) into the
 * shared lp-render package so any b2tech LP can use the white "antigravity" hero.
 *
 * A large grid of points lies on the XZ plane and undulates as a sea of layered sine waves
 * (the ambient "frame motion"). The camera looks across the field so it recedes toward a
 * horizon that dissolves into the white page via a distance fog — keeping the headline
 * readable while the foreground stays alive.
 *
 * Mouse interaction (the "wave"):
 *  - The cursor is ray-cast onto the plane; a smooth gaussian bump lifts the surface toward
 *    the pointer and a travelling ring ripples outward from it.
 *  - The camera sways slightly with the cursor for a parallax sense of depth.
 *
 * Rendering uses MULTIPLY blending so dark points darken the white background
 * order-independently (no sorting needed), and each point is a soft round dab.
 *
 * Respects prefers-reduced-motion (single static frame, no listeners), resizes with the
 * container, and disposes all GPU resources on unmount.
 */

interface ParticleFieldProps {
  className?: string;
}

// --- Calibration ------------------------------------------------------------
const PARAMS = {
  /** Grid resolution (points = (segX+1) * (segZ+1)). Reduced on small screens. */
  segX: 300,
  segZ: 200,
  segXMobile: 170,
  segZMobile: 120,
  /** World extent of the plane. */
  halfWidth: 46,
  zNear: 12, // nearest row (bottom of frame)
  zFar: -62, // farthest row (horizon)
  /** Base point size (before perspective attenuation & per-point scale). Tiny. */
  sizeBase: 1.9,
  /** Distance fog range (camera-space depth) mapping near→opaque, far→white. */
  fogNear: 16,
  fogFar: 74,
  /** Cursor easing (lerp factor per frame @60fps) and parallax sway in world units. */
  mouseEasing: 0.08,
  cameraSway: 3.0,
} as const;

// Navy/orange brand palette: warm charcoal as the neutral, lit by the brand oranges. White
// is dropped — it is invisible on a white background under MultiplyBlending.
const NEUTRAL: readonly [number, number, number] = [0.16, 0.145, 0.13]; // #29251f charcoal
const BRAND: ReadonlyArray<readonly [number, number, number]> = [
  [0.91, 0.435, 0.165], // #e86f2a brand orange
  [0.965, 0.616, 0.302], // #f69d4d light amber
  [0.784, 0.353, 0.094], // #c85a18 deep orange
];
/** Probability that a given point takes a brand orange instead of charcoal. */
const BRAND_PROBABILITY = 0.42;

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec2  uMouse;        // cursor position on the plane (world x, z)
  uniform float uMouseActive;  // 0..1 presence ramp
  uniform float uPixelRatio;
  uniform float uSizeBase;
  uniform float uFogNear;
  uniform float uFogFar;

  attribute vec3  aColor;
  attribute float aScale;

  varying vec3  vColor;
  varying float vAlpha;

  float surface(vec3 p, float t) {
    float y = 0.0;
    y += sin(p.x * 0.18 + t * 0.55) * 1.6;
    y += sin(p.z * 0.16 - t * 0.42) * 1.5;
    y += sin((p.x + p.z) * 0.12 + t * 0.33) * 1.1;
    y += sin(p.x * 0.07 - p.z * 0.09 + t * 0.70) * 0.8;
    return y;
  }

  void main() {
    vec3 pos = position;
    float t = uTime;
    float y = surface(pos, t);

    // Mouse: gaussian lift + outward travelling ring.
    float d = distance(pos.xz, uMouse);
    float bump = exp(-d * d / (2.0 * 7.0 * 7.0));
    float ring = sin(d * 0.5 - t * 3.0) * exp(-d * d / (2.0 * 12.0 * 12.0));
    y += uMouseActive * (bump * 5.0 + ring * 1.4);

    pos.y = y;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float dist = -mv.z;                       // camera-space depth (positive)
    float peak = smoothstep(-2.0, 4.0, y);    // raised points read larger/brighter

    float sizePx =
      uSizeBase * aScale * (1.0 + peak * 0.4 + uMouseActive * bump * 1.3) *
      (40.0 / dist);
    sizePx = min(sizePx, 7.0);               // keep every dab tiny & dense
    gl_PointSize = sizePx * uPixelRatio;

    float fog = 1.0 - smoothstep(uFogNear, uFogFar, dist);
    vColor = aColor;
    vAlpha = clamp(fog * (0.5 + 0.5 * peak), 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    float r = length(gl_PointCoord - 0.5);
    float circle = smoothstep(0.5, 0.32, r);   // crisp tiny speck (1px AA edge)
    float a = vAlpha * circle;
    if (a < 0.01) discard;
    // MultiplyBlending on white: low alpha -> white (no change), high -> colour.
    gl_FragColor = vec4(mix(vec3(1.0), vColor, a), 1.0);
  }
`;

export function HeroParticleField({ className }: ParticleFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const THREE = await import("three");
      if (disposed) return;

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      let width = container.clientWidth || window.innerWidth;
      let height = container.clientHeight || window.innerHeight;

      // --- Renderer ---------------------------------------------------------
      let renderer: THREE.WebGLRenderer;
      try {
        // Opaque canvas cleared to white each frame: MultiplyBlending needs a real white
        // destination to darken (it cannot accumulate on a transparent framebuffer, where
        // the alpha would stay 0 and hide the points). The section background is white too,
        // so this is seamless.
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
      } catch {
        return; // No WebGL: leave the background plain white.
      }
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      renderer.setClearColor(0xffffff, 1);
      const canvas = renderer.domElement;
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.appendChild(canvas);

      // --- Scene & camera ---------------------------------------------------
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 200);
      const camBaseX = 0;
      const camBaseY = 8;
      const camBaseZ = 17;
      camera.position.set(camBaseX, camBaseY, camBaseZ);
      camera.lookAt(0, 0, -16);

      // --- Geometry (grid of points) ----------------------------------------
      const isMobile = width < 640;
      const segX = isMobile ? PARAMS.segXMobile : PARAMS.segX;
      const segZ = isMobile ? PARAMS.segZMobile : PARAMS.segZ;
      const countX = segX + 1;
      const countZ = segZ + 1;
      const count = countX * countZ;

      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const scales = new Float32Array(count);

      const xStep = (PARAMS.halfWidth * 2) / segX;
      const zStep = (PARAMS.zNear - PARAMS.zFar) / segZ;

      let ptr = 0;
      for (let iz = 0; iz < countZ; iz++) {
        const z = PARAMS.zNear - iz * zStep;
        for (let ix = 0; ix < countX; ix++) {
          const x = -PARAMS.halfWidth + ix * xStep;
          positions[ptr * 3] = x;
          positions[ptr * 3 + 1] = 0;
          positions[ptr * 3 + 2] = z;

          const color =
            Math.random() < BRAND_PROBABILITY
              ? BRAND[(Math.random() * BRAND.length) | 0]
              : NEUTRAL;
          colors[ptr * 3] = color[0];
          colors[ptr * 3 + 1] = color[1];
          colors[ptr * 3 + 2] = color[2];

          scales[ptr] = 0.6 + Math.random() * 0.7;
          ptr++;
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));

      const uniforms = {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, -16) },
        uMouseActive: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uSizeBase: { value: PARAMS.sizeBase },
        uFogNear: { value: PARAMS.fogNear },
        uFogFar: { value: PARAMS.fogFar },
      };

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.MultiplyBlending,
        // r180 only wires the multiply blend func when this is true; otherwise it logs an
        // error every frame and falls back to plain overwrite. Our output alpha is 1.0
        // (opaque white canvas), so colours are already premultiplied.
        premultipliedAlpha: true,
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);

      // --- Pointer → plane intersection -------------------------------------
      const raycaster = new THREE.Raycaster();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const ndc = new THREE.Vector2();
      const hit = new THREE.Vector3();
      const targetMouse = new THREE.Vector2(0, -16);
      let targetActive = 0;
      const swayTarget = new THREE.Vector2(0, 0);

      const onPointerMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        ndc.set(nx, ny);
        raycaster.setFromCamera(ndc, camera);
        // Only engage the wave when the ray actually meets the plane, so the surface bump
        // never tracks a frozen/stale point above the horizon.
        if (raycaster.ray.intersectPlane(plane, hit)) {
          targetMouse.set(hit.x, hit.z);
          targetActive = 1;
        }
        swayTarget.set(nx, ny);
      };
      const onPointerLeave = () => {
        targetActive = 0;
      };

      if (!prefersReducedMotion) {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        window.addEventListener("pointerdown", onPointerMove, { passive: true });
        container.addEventListener("pointerleave", onPointerLeave, {
          passive: true,
        });
      }

      // --- Resize -----------------------------------------------------------
      const resize = () => {
        width = container.clientWidth || window.innerWidth;
        height = container.clientHeight || window.innerHeight;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(ratio);
        uniforms.uPixelRatio.value = ratio;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      // --- Reduced motion: one static frame, then stop ----------------------
      if (prefersReducedMotion) {
        uniforms.uTime.value = 1.5;
        renderer.render(scene, camera);
        cleanup = () => {
          resizeObserver.disconnect();
          geometry.dispose();
          material.dispose();
          renderer.dispose();
          if (canvas.parentNode === container) container.removeChild(canvas);
        };
        return;
      }

      // --- Animation loop ---------------------------------------------------
      let frameId = 0;
      let lastTime = 0;

      const tick = (time: number) => {
        const dt = lastTime === 0 ? 1 / 60 : Math.min((time - lastTime) / 1000, 1 / 30);
        lastTime = time;
        const fstep = dt * 60;
        const ease = Math.min(1, PARAMS.mouseEasing * fstep);

        // Accumulate clamped dt so a backgrounded tab doesn't jump the wave.
        uniforms.uTime.value += dt;
        uniforms.uMouse.value.lerp(targetMouse, ease);
        uniforms.uMouseActive.value +=
          (targetActive - uniforms.uMouseActive.value) * ease;

        // Subtle camera parallax sway toward the cursor.
        camera.position.x +=
          (camBaseX + swayTarget.x * PARAMS.cameraSway * targetActive -
            camera.position.x) *
          ease;
        camera.position.y +=
          (camBaseY - swayTarget.y * PARAMS.cameraSway * 0.6 * targetActive -
            camera.position.y) *
          ease;
        camera.lookAt(0, 0, -16);

        renderer.render(scene, camera);
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);

      // --- Cleanup ----------------------------------------------------------
      cleanup = () => {
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerdown", onPointerMove);
        container.removeEventListener("pointerleave", onPointerLeave);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        if (canvas.parentNode === container) container.removeChild(canvas);
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      aria-hidden="true"
    />
  );
}
