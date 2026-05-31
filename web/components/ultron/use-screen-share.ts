"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The operator shares the screen once (a user gesture opens the OS picker); the
// resulting MediaStream stays alive for the session so Ultron can grab frames on
// demand — silently, no second picker — whenever Claude calls capture_screen.

const MAX_CAPTURE_WIDTH = 1280; // downscale wide screens before sending
const JPEG_QUALITY = 0.7;

export type CapturedImage = { media_type: "image/jpeg"; data: string };

export function useScreenShare() {
  const [sharing, setSharing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    setSharing(false);
  }, []);

  // Must be called from a user gesture (click): getDisplayMedia requires transient
  // activation. Returns false if the operator cancels the picker.
  const start = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      videoRef.current = video;
      // Operator stopping the share via the browser's own UI ends the track.
      stream.getVideoTracks().forEach((t) => t.addEventListener("ended", stop, { once: true }));
      setSharing(true);
      return true;
    } catch {
      stop();
      return false;
    }
  }, [stop]);

  // Grabs the current frame as a downscaled JPEG (base64, no data: prefix).
  // Returns null if nothing is being shared or the frame isn't ready yet.
  const captureFrame = useCallback(async (): Promise<CapturedImage | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const scale = Math.min(1, MAX_CAPTURE_WIDTH / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    return { media_type: "image/jpeg", data: dataUrl.slice(comma + 1) };
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { sharing, start, stop, captureFrame };
}
