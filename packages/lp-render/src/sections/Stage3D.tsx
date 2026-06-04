"use client";

import { useEffect, useRef } from "react";
import { useContent } from "../content";

// Cinematic 3D panel rendered ABOVE the hero: a .glb model shown as a cyan HOLOGRAM
// (fresnel + scanlines + static + glitch) over a black void, with a MATRIX digital-rain
// backdrop, pinned-scroll scrub (spins + recedes as you scroll into the hero). Vanilla
// three.js, built once and disposed (see ADR / neural-core-scene pattern). three is
// dynamically imported so it stays out of the initial bundle and never runs during SSR.
// Driven by contentSpec.stage3d ({ model, poster?, rain?, color?, logo? }). No model → nothing.
// As you scroll (model spins + recedes), the optional `logo` (training lockup) rises + fades in
// over a bottom gradient that lifts it off the busy scene.
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function Stage3D() {
  const { contentSpec } = useContent();
  const stage = contentSpec.stage3d;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stage?.model) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed) return;

      const RAIN = stage.rain !== false;
      const RAIN_COLOR = stage.color || "#16e0ff";

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      } catch {
        return; // no WebGL → poster fallback stays visible
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      scene.fog = new THREE.FogExp2(0x000000, 0.07);

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
      const AIM_Y = 0.75;
      const ZOOM = 2.8;
      camera.position.set(0, AIM_Y, 6);
      camera.lookAt(0, AIM_Y, 0);

      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2.5, 4, 5); scene.add(key);
      const rimO = new THREE.DirectionalLight(0xff6b1a, 3.2); rimO.position.set(-4.5, 1.5, -3); scene.add(rimO);
      const rimC = new THREE.DirectionalLight(0x3aa0ff, 1.3); rimC.position.set(4.5, -1, -4); scene.add(rimC);
      scene.add(new THREE.AmbientLight(0x404050, 0.5));

      const group = new THREE.Group();
      scene.add(group);

      // ---------- matrix digital rain (cyan) ----------
      const GLYPH_GRID = 4;
      const COLS = 70, TRAIL = 14, RN = COLS * TRAIL;
      const RTOP = 5.0, RBOT = -5.0, RSPAN = RTOP - RBOT, RGAP = 0.34;
      const SPREAD_X = 7.5, SPREAD_Z = 10.0, SPD_MIN = 1.4, SPD_MAX = 3.4;
      const colX = new Float32Array(COLS), colZ = new Float32Array(COLS),
        colSpd = new Float32Array(COLS), colHead = new Float32Array(COLS);
      const rPos = new Float32Array(RN * 3), rGlyph = new Float32Array(RN), rBright = new Float32Array(RN);
      let rGeo: import("three").BufferGeometry | null = null;
      let rMat: import("three").ShaderMaterial | null = null;
      let atlas: import("three").CanvasTexture | null = null;

      if (RAIN) {
        const cellPx = 64, px = cellPx * GLYPH_GRID, cnv = document.createElement("canvas");
        cnv.width = cnv.height = px;
        const g = cnv.getContext("2d")!;
        g.clearRect(0, 0, px, px);
        g.fillStyle = "#ffffff";
        g.font = `bold ${Math.floor(cellPx * 0.78)}px "Courier New", monospace`;
        g.textAlign = "center"; g.textBaseline = "middle";
        const chars = ["0","1","2","3","4","5","6","7","8","9","0","1","0","1","7","3"];
        for (let i = 0; i < chars.length; i++) {
          g.fillText(chars[i]!, (i % GLYPH_GRID) * cellPx + cellPx / 2, Math.floor(i / GLYPH_GRID) * cellPx + cellPx / 2);
        }
        atlas = new THREE.CanvasTexture(cnv); atlas.flipY = false; atlas.needsUpdate = true;

        for (let c = 0; c < COLS; c++) {
          colX[c] = (Math.random() * 2 - 1) * SPREAD_X;
          colZ[c] = -Math.random() * SPREAD_Z + 1.0;
          colSpd[c] = SPD_MIN + Math.random() * (SPD_MAX - SPD_MIN);
          colHead[c] = RBOT + Math.random() * RSPAN;
          for (let k = 0; k < TRAIL; k++) {
            const i = c * TRAIL + k;
            rGlyph[i] = Math.floor(Math.random() * 16);
            rBright[i] = Math.pow(1 - k / TRAIL, 1.5);
          }
        }
        rGeo = new THREE.BufferGeometry();
        rGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3));
        rGeo.setAttribute("aGlyph", new THREE.BufferAttribute(rGlyph, 1));
        rGeo.setAttribute("aBright", new THREE.BufferAttribute(rBright, 1));
        rMat = new THREE.ShaderMaterial({
          uniforms: {
            uAtlas: { value: atlas }, uGrid: { value: GLYPH_GRID },
            uColor: { value: new THREE.Color(RAIN_COLOR) }, uHead: { value: new THREE.Color(0xdffcff) },
            uSize: { value: 0.55 }, uViewH: { value: 900 }, uNear: { value: 2.0 }, uFar: { value: 16.0 },
          },
          transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
          vertexShader: `
            attribute float aGlyph; attribute float aBright;
            varying float vGlyph; varying float vBright; varying float vFade;
            uniform float uSize; uniform float uViewH; uniform float uNear; uniform float uFar;
            void main(){
              vGlyph = aGlyph; vBright = aBright;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              float dist = max(-mv.z, 0.001);
              vFade = clamp((uFar - dist) / (uFar - uNear), 0.0, 1.0);
              gl_PointSize = uSize * uViewH / dist;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `
            uniform sampler2D uAtlas; uniform float uGrid; uniform vec3 uColor; uniform vec3 uHead;
            varying float vGlyph; varying float vBright; varying float vFade;
            void main(){
              vec2 cellId = vec2(mod(vGlyph, uGrid), floor(vGlyph / uGrid));
              vec2 uv = (cellId + vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)) / uGrid;
              float a = texture2D(uAtlas, uv).a;
              if (a < 0.06) discard;
              float head = smoothstep(0.78, 1.0, vBright);
              vec3 col = mix(uColor, uHead, head);
              gl_FragColor = vec4(col * (0.22 + vBright) * vFade, a * (0.3 + 0.7 * vBright) * vFade);
            }`,
        });
        const rain = new THREE.Points(rGeo, rMat);
        rain.renderOrder = -1;
        scene.add(rain);
      }

      // ---------- hologram material (keeps the rig's skinning) ----------
      const holoUniforms = {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(RAIN_COLOR) },
        uEdge: { value: new THREE.Color(0xff7a1a) },
        uFresnelPow: { value: 2.4 }, uScanFreq: { value: 90.0 }, uScanSpeed: { value: 2.0 },
        uStatic: { value: 0.22 }, uGlitch: { value: 0.5 },
      };
      const patchedMats = new Set<unknown>();
      const holoMaterial = (mat: import("three").Material) => {
        if (patchedMats.has(mat)) return;
        patchedMats.add(mat);
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
        mat.side = THREE.DoubleSide;
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, holoUniforms);
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vWN; varying vec3 vWP; varying float vWorldY;")
            .replace("#include <defaultnormal_vertex>", "#include <defaultnormal_vertex>\n  vWN = normalize(mat3(modelMatrix) * objectNormal);")
            .replace("#include <skinning_vertex>", "#include <skinning_vertex>\n  { vec3 wp = (modelMatrix * vec4(transformed,1.0)).xyz; vWP = wp; vWorldY = wp.y; }");
          shader.fragmentShader =
            "uniform float uTime; uniform vec3 uColor; uniform vec3 uEdge; uniform float uFresnelPow;\n" +
            "uniform float uScanFreq; uniform float uScanSpeed; uniform float uStatic; uniform float uGlitch;\n" +
            "varying vec3 vWN; varying vec3 vWP; varying float vWorldY;\n" +
            "float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }\n" +
            shader.fragmentShader.replace(
              "#include <opaque_fragment>",
              `#include <opaque_fragment>
               vec3 V = normalize(cameraPosition - vWP);
               float fres = pow(1.0 - abs(dot(normalize(vWN), V)), uFresnelPow);
               float scan = 0.55 + 0.45 * sin(vWorldY * uScanFreq - uTime * uScanSpeed);
               float st = h21(gl_FragCoord.xy + uTime * 73.0);
               float band = step(0.97, h21(vec2(floor(vWorldY * uScanFreq * 0.15), floor(uTime * 10.0))));
               float flick = 0.88 + 0.12 * sin(uTime * 36.0);
               vec3 holo = mix(uColor, uEdge, clamp(fres, 0.0, 1.0));
               holo += uEdge * band * uGlitch;
               holo *= (0.65 + 0.7 * fres) * scan * flick;
               holo += uColor * st * uStatic;
               float a = clamp((fres * 0.95 + 0.16) * scan * flick + st * uStatic * 0.5 + band * 0.4, 0.0, 1.0);
               gl_FragColor = vec4(holo, a);`,
            );
        };
        mat.needsUpdate = true;
      };

      // ---------- load model ----------
      let model: import("three").Object3D | null = null;
      const loader = new GLTFLoader();
      loader.load(
        stage.model,
        (gltf) => {
          if (disposed) return;
          model = gltf.scene;
          const drop: import("three").Object3D[] = [];
          model.traverse((o) => {
            const mesh = o as import("three").Mesh;
            if (!mesh.isMesh) return;
            mesh.frustumCulled = false;
            const n = (o.name || "").toLowerCase();
            if (/concrete|sphere|floor|ground|plane|backdrop|base/.test(n)) drop.push(o);
          });
          drop.forEach((o) => o.parent?.remove(o));

          let box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3(); box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          model.scale.setScalar(3.0 / maxDim);
          box = new THREE.Box3().setFromObject(model);
          const center = new THREE.Vector3(); box.getCenter(center);
          model.position.sub(center);
          group.add(model);
          model.traverse((o) => {
            const mesh = o as import("three").Mesh;
            if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(holoMaterial);
          });

          box = new THREE.Box3().setFromObject(group);
          box.getSize(size);
          const vFOV = (camera.fov * Math.PI) / 180;
          const dist = size.y / 2 / Math.tan(vFOV / 2) / ZOOM + size.z / 2;
          camera.position.set(0, AIM_Y, dist);
          camera.lookAt(0, AIM_Y, 0);
        },
        undefined,
        (e) => console.error("[stage3d] GLTF load error", e),
      );

      // ---------- scroll (pinned scrub) ----------
      let progress = 0;
      const onScroll = () => {
        const rect = wrap.getBoundingClientRect();
        const total = wrap.offsetHeight - window.innerHeight;
        const scrolled = Math.min(Math.max(-rect.top, 0), total);
        progress = total > 0 ? scrolled / total : 0;
      };
      window.addEventListener("scroll", onScroll, { passive: true });

      const resize = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
        camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
        if (rMat) rMat.uniforms.uViewH!.value = h || 900;
      };
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      const clock = new THREE.Clock();
      let curRot = 0;
      let raf = 0;
      const SPIN_TURNS = 1.25, RECEDE_Z = 5.5;
      const frame = () => {
        const dt = Math.min(clock.getDelta(), 0.05);
        holoUniforms.uTime.value += dt;
        resize();

        const targetRot = progress * Math.PI * 2 * (SPIN_TURNS / 2);
        curRot += (targetRot - curRot) * 0.12;
        group.rotation.y = curRot;
        group.position.z = -progress * RECEDE_Z;
        group.position.y = progress * 0.4;

        // logo reveal: rises + fades in over the gradient as the model recedes
        const lr = smoothstep(0.35, 0.9, progress);
        if (logoRef.current) {
          logoRef.current.style.opacity = String(lr);
          logoRef.current.style.transform = `translate(-50%, ${(1 - lr) * 60}px) scale(${0.92 + 0.08 * lr})`;
        }
        if (vignetteRef.current) vignetteRef.current.style.opacity = String(lr);

        if (rGeo) {
          for (let c = 0; c < COLS; c++) {
            let head = colHead[c]! - colSpd[c]! * dt;
            let x = colX[c]!;
            if (head < RBOT) { head += RSPAN; x = (Math.random() * 2 - 1) * SPREAD_X; colX[c] = x; }
            colHead[c] = head;
            const z = colZ[c]!;
            for (let k = 0; k < TRAIL; k++) {
              const i = c * TRAIL + k;
              rPos[i * 3] = x; rPos[i * 3 + 1] = head + k * RGAP; rPos[i * 3 + 2] = z;
            }
          }
          for (let n = 0; n < RN * 0.04; n++) rGlyph[(Math.random() * RN) | 0] = Math.floor(Math.random() * 16);
          rGeo.attributes.position!.needsUpdate = true;
          rGeo.attributes.aGlyph!.needsUpdate = true;
        }

        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      onScroll();
      resize();
      frame();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("scroll", onScroll);
        ro.disconnect();
        rGeo?.dispose();
        rMat?.dispose();
        atlas?.dispose();
        scene.traverse((o) => {
          const mesh = o as import("three").Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry?.dispose();
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m?.dispose());
        });
        pmrem.dispose();
        renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [stage?.model, stage?.rain, stage?.color]);

  if (!stage?.model) return null;
  return (
    <div className="stage3d-wrap" ref={wrapRef}>
      <div className="stage3d-sticky">
        {stage.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="stage3d-poster" src={stage.poster} alt="" />
        ) : null}
        <canvas className="stage3d-canvas" ref={canvasRef} />
        {stage.logo ? (
          <>
            <div className="stage3d-vignette" ref={vignetteRef} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="stage3d-logo" ref={logoRef} src={stage.logo} alt="" />
          </>
        ) : null}
        <div className="stage3d-hint" />
      </div>
    </div>
  );
}
