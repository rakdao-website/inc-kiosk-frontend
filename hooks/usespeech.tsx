"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal ambient typings for the Web Speech API's SpeechRecognition -
 * TypeScript's DOM lib doesn't ship these, and browser support (mainly
 * Chrome/Edge, prefixed as webkitSpeechRecognition) is inconsistent enough
 * that we treat it as an optional, feature-detected capability throughout.
 */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: { 0: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface UseSpeechResult {
  /** True only if the browser exposes SpeechRecognition. Callers should
   *  always offer a text-input fallback when this is false. */
  supported: boolean;
  listening: boolean;
  /** True while audio (server TTS or browser speech) is actively playing. */
  speaking: boolean;
  /** Speaks text aloud. Tries server-side TTS first (better voice quality);
   *  falls back to the browser's built-in speechSynthesis automatically if
   *  the server call is disabled, misconfigured, or fails for any reason.
   *  Fire-and-forget - callers don't need to await this. */
  speak: (text: string) => void;
  /** Cancels any in-progress speech output, server or browser. */
  cancelSpeech: () => void;
  /** Listens for a single utterance and resolves with the transcript, or
   *  null on timeout / no speech / unsupported browser. Never rejects. */
  listenOnce: (timeoutMs?: number) => Promise<string | null>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export function useSpeech(lang = "en-US"): UseSpeechResult {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionCtorRef = useRef<SpeechRecognitionConstructor | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ctor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    recognitionCtorRef.current = ctor;
    setSupported(!!ctor);
  }, []);

  const speakViaBrowser = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setSpeaking(false);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [lang],
  );

  const speakViaServer = useCallback(async (text: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/kiosk/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) return false;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      setSpeaking(true);
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });

      URL.revokeObjectURL(url);
      if (currentAudioRef.current === audio) {
        currentAudioRef.current = null;
        setSpeaking(false);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!text) return;
      void (async () => {
        const spokeOnServer = await speakViaServer(text);
        if (!spokeOnServer) {
          speakViaBrowser(text);
        }
      })();
    },
    [speakViaServer, speakViaBrowser],
  );

  const cancelSpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const listenOnce = useCallback(
    (timeoutMs = 8000): Promise<string | null> => {
      return new Promise((resolve) => {
        const Ctor = recognitionCtorRef.current;
        if (!Ctor) {
          resolve(null);
          return;
        }

        const recognition = new Ctor();
        recognition.lang = lang;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        let settled = false;
        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          setListening(false);
          resolve(value);
        };

        const timeoutId = window.setTimeout(() => {
          try {
            recognition.stop();
          } catch {
            // Already stopped/never started - safe to ignore.
          }
          finish(null);
        }, timeoutMs);

        recognition.onresult = (event) => {
          window.clearTimeout(timeoutId);
          const transcript = event.results?.[0]?.[0]?.transcript ?? null;
          finish(transcript);
        };
        recognition.onerror = () => {
          window.clearTimeout(timeoutId);
          finish(null);
        };
        recognition.onend = () => {
          window.clearTimeout(timeoutId);
          finish(null);
        };

        setListening(true);
        recognition.start();
      });
    },
    [lang],
  );

  return { supported, listening, speaking, speak, cancelSpeech, listenOnce };
}