"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FaceTrackStatus = "off" | "loading" | "tracking" | "no-face" | "denied" | "error";

// Normalized gaze target the 3D avatar reads each frame (ref → no React re-render).
// yaw/pitch ∈ ~[-1, 1]; active=false means "no face / off" → avatar falls back to ambient.
export type GazeSignal = { yaw: number; pitch: number; active: boolean };

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/blaze_face_short_range.tflite";
const DETECT_INTERVAL_MS = 50; // ~20 fps detection (the render loop smooths between frames)
const NO_FACE_GRACE_MS = 600; // keep tracking through brief detection gaps before relaxing
// Mirror/sign of the mapping (face position → gaze). Flip if the head turns the wrong way.
const FLIP_X = 1;
const FLIP_Y = 1;

// On-device webcam face tracking (opt-in). Frames never leave the browser — MediaPipe's
// FaceDetector runs locally on the vendored wasm + model. Exposes a gazeRef the avatar uses
// to look at the user; degrades gracefully (denied permission / no face / unsupported).
export function useFaceTracking() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<FaceTrackStatus>("off");
  const gazeRef = useRef<GazeSignal>({ yaw: 0, pitch: 0, active: false });

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    // FaceDetector instance; typed loosely to avoid importing the heavy module's types eagerly.
    let detector: {
      detectForVideo: (v: HTMLVideoElement, t: number) => { detections: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number } }> };
      close: () => void;
    } | null = null;
    let raf = 0;
    let lastDetect = 0;
    let lastFaceAt = 0;
    let lastTs = 0;
    let warned = false;

    setStatus("loading");

    const teardown = () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        detector?.close();
      } catch {
        /* already closed */
      }
      detector = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video) {
        video.srcObject = null;
        video.remove();
        video = null;
      }
      gazeRef.current = { yaw: 0, pitch: 0, active: false };
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
          audio: false,
        });
      } catch {
        if (!stopped) setStatus("denied");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // The video MUST be in the DOM (not display:none) for the browser to keep decoding
      // frames that MediaPipe can sample — a fully detached element yields no frames and
      // detectForVideo throws. Park it off-screen, invisible.
      video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("aria-hidden", "true");
      video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;";
      document.body.appendChild(video);
      try {
        await video.play();
      } catch {
        /* muted local stream autoplays; ignore transient play() rejections */
      }

      try {
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
        const created = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
        if (stopped) {
          created.close();
          return;
        }
        detector = created as unknown as typeof detector;
      } catch {
        if (!stopped) setStatus("error");
        return;
      }

      if (!stopped) setStatus("tracking");

      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        const v = video;
        if (!detector || !v || v.readyState < 2 || v.videoWidth === 0) return;

        const now = performance.now();
        if (now - lastDetect < DETECT_INTERVAL_MS) return;
        lastDetect = now;
        const ts = Math.max(now, lastTs + 1); // strictly increasing for VIDEO mode
        lastTs = ts;

        let box: { originX: number; originY: number; width: number; height: number } | undefined;
        try {
          box = detector.detectForVideo(v, ts).detections[0]?.boundingBox;
        } catch (err) {
          if (!warned) {
            warned = true;
            console.warn("[face-tracking] detectForVideo failed:", err);
          }
          return;
        }

        if (box) {
          const cx = (box.originX + box.width / 2) / v.videoWidth; // 0..1
          const cy = (box.originY + box.height / 2) / v.videoHeight; // 0..1
          gazeRef.current = {
            yaw: (cx - 0.5) * 2 * FLIP_X,
            pitch: (cy - 0.5) * 2 * FLIP_Y,
            active: true,
          };
          lastFaceAt = now;
          setStatus((s) => (s === "no-face" ? "tracking" : s));
        } else if (now - lastFaceAt > NO_FACE_GRACE_MS) {
          gazeRef.current.active = false;
          setStatus((s) => (s === "tracking" ? "no-face" : s));
        }
      };
      loop();
    })();

    return () => {
      teardown();
      setStatus("off");
    };
  }, [enabled]);

  return { enabled, status, toggle, gazeRef };
}
