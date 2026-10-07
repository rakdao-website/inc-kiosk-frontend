"use client";

import { useEffect, useRef } from "react";

import { requestJson } from "@/lib/api";

/* -------------------------------------------------------------------------
   "Is someone standing in front of the kiosk?"

   The idle welcome screen switches to check-in the moment this fires.
   Three sources, whichever comes first:

   1. The outer (entrance) camera. Your recognition service can push a
      presence signal to the page at any time with:
        window.dispatchEvent(new CustomEvent("kiosk:presence", { detail: { present: true } }))
      e.g. from a WebSocket/SSE listener. This is the most reliable source.
   2. The kiosk camera, checked several times a second at very low resolution:
      - with the browser's FaceDetector (Chrome's Shape Detection API) it
        waits for a face big enough to mean "close to the screen";
      - otherwise a small frame goes to the backend (POST /api/kiosk/presence,
        face detection only, nothing is stored), so a person who just stands
        there is noticed as soon as their face is in view, even if they are
        perfectly still;
      - if the backend can't be reached it falls back to looking for
        sustained movement in the centre of the frame.
   3. A tap anywhere on the screen.

   The camera is released as soon as presence is detected, so the face
   scan that follows can open it without a conflict.
   ------------------------------------------------------------------------- */

/** Face width as a share of the frame that counts as "close". */
const FACE_MIN_WIDTH = 0.15;
/** Share of the centre region that must change between checks (motion fallback). */
const MOTION_RATIO = 0.10;
/** Consecutive positive checks needed (at 250ms each). */
const FACE_HITS = 2;
const MOTION_HITS = 2;
const CHECK_MS = 250;
/** Size of the frame sent to the backend for the presence check. */
const PROBE_WIDTH = 320;
const PROBE_HEIGHT = 240;
/** Backend failures in a row before switching to the movement check. */
const SERVER_FAILURES_BEFORE_FALLBACK = 3;

type Face = { boundingBox: DOMRectReadOnly };
type FaceDetectorLike = { detect: (source: HTMLVideoElement) => Promise<Face[]> };

export function usePresence(active: boolean, onPresent: () => void) {
  const onPresentRef = useRef(onPresent);
  onPresentRef.current = onPresent;

  useEffect(() => {
    if (!active) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;

    const cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener("kiosk:presence", onEvent);
      window.removeEventListener("pointerdown", fire);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    function fire() {
      if (stopped) return;
      stopped = true;
      cleanup();
      onPresentRef.current();
    }

    function onEvent(event: Event) {
      const detail = (event as CustomEvent<{ present?: boolean }>).detail;
      if (!detail || detail.present !== false) fire();
    }

    window.addEventListener("kiosk:presence", onEvent);
    window.addEventListener("pointerdown", fire);

    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
          audio: false,
        });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;

        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = media;
        await video.play();

        const FaceDetectorCtor = (window as unknown as { FaceDetector?: new (options: object) => FaceDetectorLike }).FaceDetector;
        let detector: FaceDetectorLike | null = FaceDetectorCtor
          ? new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 })
          : null;

        const W = 48;
        const H = 36;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        let previous: Float32Array | null = null;
        let hits = 0;

        // Face detection on the backend, used when the browser has no FaceDetector.
        let useServer = !detector;
        let serverHits = 0;
        let serverFailures = 0;
        let probeInFlight = false;
        const probe = document.createElement("canvas");
        probe.width = PROBE_WIDTH;
        probe.height = PROBE_HEIGHT;
        const probeCtx = probe.getContext("2d");

        timer = window.setInterval(async () => {
          if (stopped || !ctx) return;

          if (useServer && probeCtx) {
            if (probeInFlight) return; // one check at a time; the next tick tries again
            probeInFlight = true;
            try {
              probeCtx.drawImage(video, 0, 0, PROBE_WIDTH, PROBE_HEIGHT);
              const result = await requestJson<{ faces: number; face_width_ratio: number }>("/api/kiosk/presence", {
                method: "POST",
                body: JSON.stringify({ image_base64: probe.toDataURL("image/jpeg", 0.6) }),
              });
              serverFailures = 0;
              serverHits = result.faces > 0 && result.face_width_ratio >= FACE_MIN_WIDTH ? serverHits + 1 : 0;
              if (serverHits >= FACE_HITS) fire();
            } catch {
              serverFailures += 1;
              if (serverFailures >= SERVER_FAILURES_BEFORE_FALLBACK) useServer = false; // use movement instead
            } finally {
              probeInFlight = false;
            }
            return;
          }

          if (detector) {
            try {
              const faces = await detector.detect(video);
              const close = faces.some((face) => face.boundingBox.width / (video.videoWidth || 320) >= FACE_MIN_WIDTH);
              hits = close ? hits + 1 : 0;
              if (hits >= FACE_HITS) fire();
              return;
            } catch {
              detector = null; // unsupported on this device -- use motion from now on
            }
          }

          ctx.drawImage(video, 0, 0, W, H);
          const { data } = ctx.getImageData(0, 0, W, H);
          const luminance = new Float32Array(W * H);
          for (let i = 0; i < W * H; i += 1) {
            luminance[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
          }
          if (previous) {
            // Centre region only (middle 2/3 across, most of the height).
            let changed = 0;
            let total = 0;
            for (let y = 3; y < H - 3; y += 1) {
              for (let x = Math.floor(W / 6); x < W - Math.floor(W / 6); x += 1) {
                total += 1;
                if (Math.abs(luminance[y * W + x] - previous[y * W + x]) > 20) changed += 1;
              }
            }
            hits = changed / total >= MOTION_RATIO ? hits + 1 : 0;
            if (hits >= MOTION_HITS) fire();
          }
          previous = luminance;
        }, CHECK_MS);
      } catch {
        // No camera (or permission denied): the outer-camera event and a
        // tap on the screen still work.
      }
    })();

    return () => {
      stopped = true;
      cleanup();
    };
  }, [active]);
}