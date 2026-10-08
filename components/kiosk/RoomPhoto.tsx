"use client";

import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import { centerRoomOptions } from "@/lib/kiosk-content";
import { localRoomPhoto, photoCandidates, ROOM_PHOTOS } from "@/lib/room-photos";

/* -------------------------------------------------------------------------
   Room photo on the booking screens.

   Photos are served from public/ -- the kiosk looks for each file in
   public/images/ first (where the voice assistant always loaded them),
   then public/brand/images/, and in both .PNG and .png, and uses whichever
   exists (see <PhotoImg>). If none is found it logs the paths it tried.

   The photo is never cropped: it's scaled to fit inside the card
   (object-fit: contain), and a blurred copy of the same photo fills any
   leftover space, so photos of any shape look intentional.
   ------------------------------------------------------------------------- */

export { ROOM_PHOTOS, localRoomPhoto, photoCandidates };

// Remember which location worked, so every later image loads it first time.
const resolved = new Map<string, string>();

/** <img> that tries each possible location until one loads. */
export function PhotoImg({
  src,
  fallbackSrc,
  onAllFailed,
  ...props
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src: string;
  /** The built-in photo to show if `src` (a Spacebring photo) cannot be loaded. */
  fallbackSrc?: string;
  onAllFailed?: () => void;
}) {
  const candidates = photoCandidates(src, fallbackSrc);
  const [index, setIndex] = useState(() => Math.max(0, candidates.indexOf(resolved.get(src) ?? src)));
  const current = candidates[index];
  return (
    <img
      {...props}
      onError={() => {
        if (index + 1 < candidates.length) {
          setIndex(index + 1);
        } else {
          console.warn(`Room photo not found. Tried: ${candidates.join(", ")}`);
          onAllFailed?.();
        }
      }}
      onLoad={() => resolved.set(src, current)}
      src={current}
    />
  );
}

/* Room details come from your own content (lib/kiosk-content.ts ->
   centerRoomOptions, the list on "Explore the center"), matched by name,
   so the kiosk never shows made-up facts. Edit them there. */
const ROOM_MATCHERS: Record<string, RegExp[]> = {
  MR_1: [/meeting\s*room\s*(1|one)\b/i, /meeting/i],
  MR_2: [/meeting\s*room\s*(2|two)\b/i, /meeting/i],
  podcast_studio: [/podcast/i],
  tiktok_studio: [/tik\s*tok/i],
};

export function roomDescription(key: string): string | null {
  for (const pattern of ROOM_MATCHERS[key] ?? []) {
    const match = centerRoomOptions.find((option) => pattern.test(option.title));
    if (match) return match.description;
  }
  return null;
}

/* Room facts shown as chips. Taken from the backend's own sources, so the
   screen says what Sky says:
     capacity  -> backend knowledge_base.md ("Meeting Rooms" section; it's
                  what the voice assistant tells visitors)
     features, floor, free-use note -> backend room_question_service.py
                  (ROOM_DETAILS)
   NOTE: room_question_service.py lists both meeting rooms as "6-7"; the
   knowledge base says 6 and 5. Keep the two in sync and update here. */
export const ROOM_FACTS: Record<string, string[]> = {
  MR_1: ["Up to 6 people", "Large table", "TV screen"],
  MR_2: ["Up to 5 people", "Large table", "TV screen"],
  podcast_studio: ["Ground Floor", "Free for customers (limited hours)"],
  tiktok_studio: ["Ground Floor", "Free for customers (limited hours)"],
};

function FactChips({ facts, className }: { facts?: string[]; className: string }) {
  if (!facts || facts.length === 0) return null;
  return (
    <span className={className}>
      {facts.map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
    </span>
  );
}

type RoomOption = { value: string; label: string };

export function RoomPhoto({
  src,
  fallbackSrc,
  label,
  description,
  facts,
  options,
  value,
  onChange,
}: {
  src: string;
  /** Built-in photo used if `src` cannot be loaded. */
  fallbackSrc?: string;
  /** Short facts (capacity, equipment) shown as chips on the photo. */
  facts?: string[];
  /** Name shown on the photo (when there's no room choice). */
  label: string;
  /** Short line under the name (from kiosk-content). */
  description?: string | null;
  /** Room choices shown as buttons on the photo (meeting rooms). */
  options?: RoomOption[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [enlarged, setEnlarged] = useState(false);
  // If a photo file is missing, the card just isn't shown.
  if (failed[src] && !options) return null;

  return (
    <figure className="room-photo">
      {!failed[src] ? (
        <>
          <PhotoImg alt="" aria-hidden className="room-photo-fill" fallbackSrc={fallbackSrc} key={`fill-${src}`} src={src} />
          <PhotoImg
            alt={label}
            className="room-photo-img"
            decoding="async"
            fallbackSrc={fallbackSrc}
            key={src}
            onAllFailed={() => setFailed((current) => ({ ...current, [src]: true }))}
            src={src}
          />
          <FactChips className="room-photo-facts" facts={facts} />
          {/* Tap the photo to see it full size. */}
          <button aria-label={`View ${label} photo full size`} className="room-photo-zoom" onClick={() => setEnlarged(true)} type="button">
            <Maximize2 aria-hidden />
          </button>
        </>
      ) : (
        <span className="room-photo-missing">{label}</span>
      )}

      <figcaption className="room-photo-bar">
        {options ? (
          <div className="room-photo-tabs" role="radiogroup" aria-label="Choose a room">
            {options.map((option) => (
              <button
                aria-checked={value === option.value}
                className={value === option.value ? "active" : ""}
                key={option.value}
                onClick={() => onChange?.(option.value)}
                role="radio"
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="room-photo-label">
            {label}
            {description ? <small>{description}</small> : null}
          </span>
        )}
      </figcaption>

      {enlarged ? (
        <div className="room-photo-viewer" onClick={() => setEnlarged(false)} role="dialog" aria-label={`${label} photo`}>
          <PhotoImg alt={label} src={src} />
          <span className="room-photo-viewer-label">{label}</span>
          <button aria-label="Close photo" className="room-photo-viewer-close" onClick={() => setEnlarged(false)} type="button">
            <X aria-hidden />
          </button>
        </div>
      ) : null}
    </figure>
  );
}

/** Warm the browser cache so switching rooms shows the photo instantly. */
export function preloadRoomPhotos() {
  if (typeof window === "undefined") return;
  Object.values(ROOM_PHOTOS).forEach((src) => {
    const candidates = photoCandidates(src);
    const tryAt = (i: number) => {
      if (i >= candidates.length || resolved.has(src)) return;
      const image = new Image();
      image.onload = () => resolved.set(src, candidates[i]);
      image.onerror = () => tryAt(i + 1);
      image.src = candidates[i];
    };
    tryAt(0);
  });
}

/** Big photo card on the "Choose your room" screen. The whole photo shows. */
export function RoomChoiceCard({
  src,
  fallbackSrc,
  label,
  description,
  facts,
  selected,
  onChoose,
}: {
  src: string;
  /** Built-in photo used if `src` cannot be loaded. */
  fallbackSrc?: string;
  label: string;
  description?: string | null;
  facts?: string[];
  selected?: boolean;
  onChoose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button className={selected ? "glass-card room-choice selected" : "glass-card room-choice"} onClick={onChoose} type="button">
      <span className="room-choice-photo">
        {!failed ? (
          <>
            <PhotoImg alt="" aria-hidden className="room-photo-fill" fallbackSrc={fallbackSrc} src={src} />
            <PhotoImg alt={label} className="room-photo-img" decoding="async" fallbackSrc={fallbackSrc} onAllFailed={() => setFailed(true)} src={src} />
          </>
        ) : (
          <span className="room-photo-missing">{label}</span>
        )}
      </span>
      <span className="room-choice-info">
        <span className="room-choice-text">
          <b>{label}</b>
          {description ? <span>{description}</span> : null}
          <FactChips className="room-choice-facts" facts={facts} />
        </span>
        <span className="room-choice-cta">Choose</span>
      </span>
      <span aria-hidden className="corner-tick">
        <i />
        <i />
      </span>
    </button>
  );
}