"use client";

import { useEffect, useRef } from "react";

type SignalConstellationProps = {
  className?: string;
  /** Number of layers, input → output, like an MLP diagram. */
  layerCount?: number;
  /** How many signals are propagating through the network at once. */
  pulseCount?: number;
};

// Same accent pair as LivingBlobMesh — #62cbde (cyan, used across
// .primary-btn / .page-voice-btn) and #7f77dd (violet, paired with it in
// .camera-ring's conic gradient) — so the two backgrounds are swappable
// without the palette shifting underneath them.
const TEAL = "98,203,222";
const VIOLET = "127,119,221";

type Node = { baseX: number; baseY: number; x: number; y: number; phase: number; glow: number };
type Pulse = {
  layer: number; // layer index the signal is currently departing from
  from: number; // node index within `layer`
  to: number; // node index within `layer + 1`
  progress: number; // 0–1 across the current edge
  speed: number;
  hue: "teal" | "violet";
  hold: number; // frames left waiting at the output layer before respawning
};

/**
 * Ambient background styled after an MLP diagram: fixed layers of nodes,
 * every adjacent pair of layers fully wired together, with a handful of
 * "activation" signals propagating forward through the network on their
 * own — no pointer/touch input, safe for a kiosk with no cursor. Renders
 * one static frame under prefers-reduced-motion instead of looping.
 */
export function SignalConstellation({
  className = "kiosk-bg-layer",
  layerCount = 5,
  pulseCount = 4,
}: SignalConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let layers: Node[][] = [];
    let pulses: Pulse[] = [];
    let frameId = 0;
    let animating = false;
    let t = 0;

    // simple seeded jitter so node spacing looks organic, not a sterile grid
    function jitter(seed: number) {
      const x = Math.sin(seed * 12.9898) * 43758.5453;
      return x - Math.floor(x) - 0.5;
    }

    function nodesInLayer(i: number, total: number, base: number) {
      if (i === 0) return Math.max(3, Math.round(base * 0.75)); // input
      if (i === total - 1) return Math.max(2, Math.round(base * 0.35)); // output
      return base; // hidden layers, full width
    }

    function randomNodeIndex(layerIndex: number) {
      const count = layers[layerIndex]?.length ?? 1;
      return Math.floor(Math.random() * count);
    }

    function spawnPulse(hue: "teal" | "violet"): Pulse {
      return {
        layer: 0,
        from: randomNodeIndex(0),
        to: randomNodeIndex(1),
        progress: Math.random(), // stagger starting points so pulses aren't in lockstep
        speed: 0.012 + Math.random() * 0.01,
        hue,
        hold: 0,
      };
    }

    function setup() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const baseCount = Math.max(4, Math.min(9, Math.round(height / 78)));
      const xMargin = width * 0.12;
      const yMargin = height * 0.08;

      layers = Array.from({ length: layerCount }, (_, i) => {
        const count = nodesInLayer(i, layerCount, baseCount);
        const x = layerCount === 1 ? width / 2 : xMargin + (i / (layerCount - 1)) * (width - xMargin * 2);
        const usable = height - yMargin * 2;
        return Array.from({ length: count }, (_, j) => {
          const y = usable <= 0 ? height / 2 : yMargin + ((j + 0.5) / count) * usable + jitter(i * 97 + j) * (usable / count) * 0.4;
          const seed = i * 97 + j;
          return { baseX: x, baseY: y, x, y, phase: seed % 6.28, glow: 0 };
        });
      });

      pulses = Array.from({ length: pulseCount }, (_, i) => spawnPulse(i % 2 === 0 ? "teal" : "violet"));
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      // settle node wobble (skip entirely under reduced motion — grid stays put)
      layers.forEach((layer) => {
        layer.forEach((n) => {
          if (!reduceMotion) {
            n.x = n.baseX + Math.sin(t * 0.6 + n.phase) * 2.2;
            n.y = n.baseY + Math.cos(t * 0.5 + n.phase) * 2.2;
          }
          n.glow *= 0.94;
        });
      });

      // full synaptic mesh between adjacent layers — faint by default
      ctx!.lineWidth = 1;
      for (let i = 0; i < layers.length - 1; i += 1) {
        layers[i].forEach((a) => {
          layers[i + 1].forEach((b) => {
            ctx!.strokeStyle = `rgba(${TEAL},0.09)`;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          });
        });
      }

      // active signals travelling forward, layer by layer
      pulses.forEach((p) => {
        const fromLayer = layers[p.layer];
        const toLayer = layers[p.layer + 1];
        if (!fromLayer || !toLayer) return;
        const a = fromLayer[p.from];
        const b = toLayer[p.to];
        if (!a || !b) return;

        const color = p.hue === "teal" ? TEAL : VIOLET;

        if (p.hold > 0) {
          if (!reduceMotion) p.hold -= 1;
          b.glow = Math.max(b.glow, 1);
        } else {
          if (!reduceMotion) p.progress += p.speed;

          // highlight the edge currently carrying this signal
          ctx!.strokeStyle = `rgba(${color},0.55)`;
          ctx!.lineWidth = 1.4;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();

          const ease = p.progress * p.progress * (3 - 2 * p.progress); // smoothstep
          const px = a.x + (b.x - a.x) * ease;
          const py = a.y + (b.y - a.y) * ease;
          ctx!.fillStyle = `rgba(${color},0.95)`;
          ctx!.beginPath();
          ctx!.arc(px, py, 2.4, 0, Math.PI * 2);
          ctx!.fill();

          a.glow = Math.max(a.glow, 0.6);

          if (p.progress >= 1) {
            b.glow = 1;
            if (p.layer + 1 >= layers.length - 1) {
              p.hold = 24; // let the output node sit lit for a moment
            } else {
              p.layer += 1;
              p.from = p.to;
              p.to = randomNodeIndex(p.layer + 1);
              p.progress = 0;
            }
          }
        }

        if (p.hold === 1 || (p.hold === 0 && p.layer + 1 >= layers.length - 1 && p.progress >= 1)) {
          // respawn back at the input layer
          Object.assign(p, spawnPulse(p.hue));
        }
      });

      // node dots on top, brighter where a signal just passed through
      layers.forEach((layer) => {
        layer.forEach((n) => {
          const active = n.glow > 0.05;
          const color = active ? VIOLET : TEAL;
          ctx!.fillStyle = `rgba(${color},${0.5 + n.glow * 0.5})`;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, active ? 2 + n.glow * 1.6 : 1.8, 0, Math.PI * 2);
          ctx!.fill();
        });
      });
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
  }, [layerCount, pulseCount]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}