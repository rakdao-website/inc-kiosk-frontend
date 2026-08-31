"use client";

import { useEffect, useRef } from "react";

type LivingBlobMeshProps = {
  className?: string;
};

// Same accent pair as SignalConstellation — #62cbde (cyan, used across
// .primary-btn / .page-voice-btn) and #7f77dd (violet, paired with it in
// .camera-ring's conic gradient) — so the two backgrounds are swappable
// without the palette shifting underneath them.
const TEAL = "98,203,222";
const VIOLET = "127,119,221";

type Blob = {
  ox: number; // origin x, 0–1 of width
  oy: number; // origin y, 0–1 of height
  r: number; // radius, relative to max(width, height)
  color: string;
  phase: number;
  speed: number;
  driftX: number;
  driftY: number;
};

const BLOBS: Blob[] = [
  { ox: 0.28, oy: 0.32, r: 0.52, color: TEAL, phase: 0, speed: 0.55, driftX: 0.16, driftY: 0.12 },
  { ox: 0.74, oy: 0.64, r: 0.48, color: VIOLET, phase: 2.1, speed: 0.42, driftX: 0.14, driftY: 0.16 },
  { ox: 0.5, oy: 0.2, r: 0.34, color: TEAL, phase: 4.2, speed: 0.6, driftX: 0.12, driftY: 0.14 },
];

/**
 * Ambient background: the banner's soft gradient blobs, slowly breathing
 * and drifting on their own fixed paths. No pointer/touch input involved —
 * safe for a kiosk with no cursor. Renders one static frame under
 * prefers-reduced-motion instead of looping, same as SignalConstellation.
 */
export function LivingBlobMesh({ className = "kiosk-bg-layer" }: LivingBlobMeshProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let frameId = 0;
    let animating = false;
    let t = 0;

    function setup() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      ctx!.filter = "blur(38px)";
      BLOBS.forEach((b) => {
        const bx = (b.ox + Math.sin(t * b.speed + b.phase) * b.driftX) * width;
        const by = (b.oy + Math.cos(t * b.speed * 0.8 + b.phase) * b.driftY) * height;
        const r = b.r * Math.max(width, height);
        const gradient = ctx!.createRadialGradient(bx, by, 0, bx, by, r);
        gradient.addColorStop(0, `rgba(${b.color},0.6)`);
        gradient.addColorStop(1, `rgba(${b.color},0)`);
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.arc(bx, by, r, 0, Math.PI * 2);
        ctx!.fill();
      });
      ctx!.filter = "none";
    }

    function loop() {
      t += 0.02;
      draw();
      if (animating) frameId = requestAnimationFrame(loop);
    }

    function start() {
      if (animating) return;
      animating = !reduceMotion && document.visibilityState === "visible";
      if (animating) loop();
      else draw();
    }

    function stop() {
      animating = false;
      cancelAnimationFrame(frameId);
    }

    const resizeObserver = new ResizeObserver(() => {
      setup();
      if (!animating) draw();
    });
    resizeObserver.observe(canvas);
    setup();
    start();

    function handleVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}