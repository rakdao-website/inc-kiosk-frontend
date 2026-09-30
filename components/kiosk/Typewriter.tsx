"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Types `text` in place. When `text` changes it backspaces to the part the
 * two texts share, then types the rest -- so "Welcome to Innovation City"
 * turns into "Let's get you checked in" on the same spot.
 *
 * The finished text is laid out invisibly underneath, so the block keeps
 * its final size the whole time and nothing around it jumps while typing.
 * Use "\n" for line breaks. Screen readers get the full text at once.
 */
export function Typewriter({
  text,
  as: Tag = "p",
  className,
  typeMs = 42,
  eraseMs = 16,
  delayMs = 0,
  onDone,
}: {
  text: string;
  as?: "p" | "h1" | "span";
  className?: string;
  typeMs?: number;
  eraseMs?: number;
  delayMs?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState("");
  const [typing, setTyping] = useState(true);
  const shownRef = useRef("");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let timer = 0;
    let current = shownRef.current;
    const show = (value: string) => {
      current = value;
      shownRef.current = value;
      setShown(value);
    };

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      show(text);
      setTyping(false);
      onDoneRef.current?.();
      return;
    }

    let shared = 0;
    while (shared < current.length && shared < text.length && current[shared] === text[shared]) shared += 1;

    // Erase first (only while the old text is longer than the shared
    // start), then switch to typing for good.
    let erasing = current.length > shared;
    const tick = () => {
      if (erasing && current.length > shared) {
        show(current.slice(0, -1));
        timer = window.setTimeout(tick, eraseMs);
        return;
      }
      erasing = false;
      if (current.length < text.length) {
        show(text.slice(0, current.length + 1));
        // A short pause after each line break reads more naturally.
        timer = window.setTimeout(tick, text[current.length - 1] === "\n" ? typeMs * 4 : typeMs);
      } else {
        setTyping(false);
        onDoneRef.current?.();
      }
    };

    setTyping(true);
    timer = window.setTimeout(tick, delayMs);
    return () => window.clearTimeout(timer);
  }, [text, typeMs, eraseMs, delayMs]);

  return (
    <Tag aria-label={text.replace(/\n/g, " ")} className={["typewriter", className].filter(Boolean).join(" ")}>
      <span aria-hidden className="tw-ghost">
        {text}
      </span>
      <span aria-hidden className="tw-live">
        {shown}
        <span className={typing ? "tw-caret on" : "tw-caret"} />
      </span>
    </Tag>
  );
}