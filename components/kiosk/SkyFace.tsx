"use client";

import { useEffect, useState } from "react";

export type SkyState = "off" | "connecting" | "idle" | "listening" | "speaking";

// Aspect ratio of /public/brand/sky-head-base.png (157x165).
const RATIO = 157 / 165;

// Mouth box (top/left/width/height) is the calibration measured from the
// source art in the previous version -- kept identical so the mouth never
// spills past the face's edge.
const MOUTH_BOX = { top: "39.3%", left: "24.8%", width: "58%", height: "14%" } as const;

function buildWavePath(phase: number): string {
  const steps = 10;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = 28 + (i / steps) * 44;
    const y = 15 + Math.sin((i / steps) * Math.PI * 2 + phase) * 6;
    points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

/**
 * Sky's head. "off" = resting (static smile, no animation) -- shown in
 * the bottom bar until the visitor taps it. Every other state is the live
 * assistant: idle/connecting blink between a line and a smile, listening
 * draws a moving wave, speaking bounces 7 bars.
 *
 * Timers stay slow (200-220ms) on purpose: faster ones added enough CPU
 * load on kiosk hardware to delay the realtime audio pipeline.
 */
export function SkyFace({ state, height = 160 }: { state: SkyState; height?: number }) {
  const [smiling, setSmiling] = useState(false);
  const [wavePhase, setWavePhase] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array(7).fill(4));

  useEffect(() => {
    if (state !== "idle" && state !== "connecting") {
      setSmiling(false);
      return;
    }
    const t = setInterval(() => setSmiling((s) => !s), 1500);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (state !== "listening") return;
    const t = setInterval(() => setWavePhase((p) => (p + 0.5) % (Math.PI * 2)), 200);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (state !== "speaking") return;
    const t = setInterval(() => setBars(Array.from({ length: 7 }, () => 3 + Math.random() * 10)), 220);
    return () => clearInterval(t);
  }, [state]);

  const showBlink = state === "off" || state === "idle" || state === "connecting";
  // Resting Sky (before the tap) smiles, as in the Figma bottom bar.
  const smile = state === "off" || smiling;

  return (
    <span className={`sky-face sky-${state}`} style={{ width: height * RATIO, height }}>
      <img src="/brand/sky-head-base.png" alt="" draggable={false} />
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ position: "absolute", ...MOUTH_BOX }}>
        {showBlink ? (
          <>
            <path d="M 28,15 L 72,15" className="sky-mouth" style={{ opacity: smile ? 0 : 1 }} />
            <path d="M 28,10 Q 50,27 72,10" className="sky-mouth" style={{ opacity: smile ? 1 : 0 }} />
          </>
        ) : null}
        {state === "listening" ? <path d={buildWavePath(wavePhase)} className="sky-mouth" strokeWidth={5} /> : null}
        {state === "speaking"
          ? bars.map((h, i) => (
              <rect key={i} x={28 + i * (44 / 6) - 3} y={15 - h / 2} width="6" height={h} rx="3" fill="#f5f7fb" className="sky-bar" />
            ))
          : null}
      </svg>
    </span>
  );
}
