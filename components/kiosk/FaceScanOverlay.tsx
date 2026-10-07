"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { useLang } from "./i18n";

export type KycPhase = "starting" | "align" | "scanning" | "checking" | "found" | "not-found" | "error";

const TICKS = 72;
// Oval the face sits in (kiosk-frame px). Keep in sync with --kyc-* in CSS.
const OVAL = { cx: 540, cy: 820, rx: 280, ry: 360 };

export type KycMode = "check-in" | "enroll";

const COPY: Record<KycPhase, { title: string; sub: string }> = {
  starting: { title: "Opening the camera…", sub: "One moment" },
  align: { title: "Place your face in the frame", sub: "Look straight at the screen" },
  scanning: { title: "Scanning your face", sub: "Hold still" },
  checking: { title: "Checking your profile…", sub: "This takes a few seconds" },
  found: { title: "Profile found", sub: "Welcome back!" },
  "not-found": { title: "No match found", sub: "Let's get you set up" },
  error: { title: "Couldn't scan", sub: "Please try again or choose another option" },
};

// New visitors saving their face for the first time.
const ENROLL_COPY: Record<KycPhase, { title: string; sub: string }> = {
  ...COPY,
  align: { title: "Place your face in the frame", sub: "We'll save it for faster check-in next time" },
  checking: { title: "Saving your face…", sub: "Almost done" },
  found: { title: "Face saved", sub: "Next time we'll welcome you by name" },
  error: { title: "We couldn't see your face clearly", sub: "Look straight at the screen, then try again" },
};

/**
 * Full-screen KYC-style face scan. Opens the camera itself and hands the
 * stream to the page via `onStream`, so the page's capture code uses the
 * very same camera feed the visitor is watching (no second camera open).
 *
 * The live picture is shown twice: once blurred and darkened as the
 * background, once sharp and clipped to the oval -- so only the face is
 * in focus. The ring of ticks around the oval fills up while scanning.
 */
export function FaceScanOverlay({
  phase,
  mode = "check-in",
  scanMs,
  onStream,
  onCameraError,
  onCancel,
  errorActions,
}: {
  phase: KycPhase;
  /** "enroll" = a new visitor saving their face (different wording). */
  mode?: KycMode;
  /** Buttons shown under the message when phase is "error" (e.g. retry / skip). */
  errorActions?: ReactNode;
  /** How long the "scanning" fill takes (matches the page's timing). */
  scanMs: number;
  onStream: (stream: MediaStream) => void;
  onCameraError: (message: string) => void;
  onCancel: () => void;
}) {
  const backRef = useRef<HTMLVideoElement>(null);
  const faceRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const onStreamRef = useRef(onStream);
  const onErrorRef = useRef(onCameraError);
  onStreamRef.current = onStream;
  onErrorRef.current = onCameraError;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        for (const video of [backRef.current, faceRef.current]) {
          if (!video) continue;
          video.srcObject = media;
          await video.play().catch(() => undefined);
        }
        setReady(true);
        onStreamRef.current(media);
      } catch (error) {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : "Camera unavailable.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const { t } = useLang();
  const { title, sub } = (mode === "enroll" ? ENROLL_COPY : COPY)[phase];
  const showErrorActions = phase === "error" && Boolean(errorActions);
  const canCancel =
    phase === "starting" || phase === "align" || phase === "scanning" || (phase === "error" && !showErrorActions);

  // Tick marks around the oval, pointing outwards.
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
    const x1 = OVAL.cx + Math.cos(a) * (OVAL.rx + 26);
    const y1 = OVAL.cy + Math.sin(a) * (OVAL.ry + 26);
    const x2 = OVAL.cx + Math.cos(a) * (OVAL.rx + (i % 6 === 0 ? 58 : 46));
    const y2 = OVAL.cy + Math.sin(a) * (OVAL.ry + (i % 6 === 0 ? 58 : 46));
    return <line key={i} style={{ animationDelay: `${(i / TICKS) * scanMs}ms` }} x1={x1} x2={x2} y1={y1} y2={y2} />;
  });

  return (
    <div className={`kyc kyc-${phase}${ready ? " ready" : ""}`} role="dialog" aria-label="Face scan" aria-live="polite">
      <video aria-hidden className="kyc-video kyc-back" muted playsInline ref={backRef} />
      <div aria-hidden className="kyc-shade" />
      <video aria-hidden className="kyc-video kyc-face" muted playsInline ref={faceRef} />

      <svg aria-hidden className="kyc-frame" viewBox="0 0 1080 1920">
        <defs>
          <linearGradient id="kyc-grad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#86d0da" />
            <stop offset="1" stopColor="#8a5fa8" />
          </linearGradient>
          <clipPath id="kyc-oval">
            <ellipse cx={OVAL.cx} cy={OVAL.cy} rx={OVAL.rx} ry={OVAL.ry} />
          </clipPath>
        </defs>
        <ellipse className="kyc-oval-line" cx={OVAL.cx} cy={OVAL.cy} rx={OVAL.rx} ry={OVAL.ry} />
        <ellipse className="kyc-oval-glow" cx={OVAL.cx} cy={OVAL.cy} rx={OVAL.rx} ry={OVAL.ry} />
        <g className="kyc-ticks">{ticks}</g>
        <g clipPath="url(#kyc-oval)">
          <rect className="kyc-scanline" height="90" width={OVAL.rx * 2} x={OVAL.cx - OVAL.rx} y={OVAL.cy - OVAL.ry} />
        </g>
        <ellipse className="kyc-spinner" cx={OVAL.cx} cy={OVAL.cy} rx={OVAL.rx + 12} ry={OVAL.ry + 12} />
      </svg>

      {phase === "found" ? (
        <span className="kyc-badge">
          <Check aria-hidden />
        </span>
      ) : null}

      <div className="kyc-copy">
        <span className="kyc-step">{t(mode === "enroll" ? "Face registration" : "Face check-in")}</span>
        <h2 key={title}>{t(title)}</h2>
        <p>{t(sub)}</p>
        {showErrorActions ? <div className="kyc-actions">{errorActions}</div> : null}
      </div>

      {canCancel ? (
        <button className="kyc-cancel" onClick={onCancel} type="button">
          <X aria-hidden />
          <span>{t(phase === "error" ? "Close" : "Cancel")}</span>
        </button>
      ) : null}
    </div>
  );
}
