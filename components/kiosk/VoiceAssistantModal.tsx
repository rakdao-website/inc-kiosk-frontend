"use client";

import { useEffect, useState } from "react";
import { Mic } from "lucide-react";

import { ApiRequestError, requestJson } from "@/lib/api";
import { useSpeech } from "@/public/hooks/usespeech";

export interface VoiceFieldConfig {
  key: string;
  label: string;
  /** What the assistant says out loud when this field comes up. */
  prompt: string;
  /** Current value, read from the parent's real form state (so this modal
   *  never owns data - it only ever writes back through onFieldChange). */
  value: string;
  kind?: "text" | "email" | "phone" | "notes";
}

interface RoomQuestionResponse {
  answer: string;
  source: "llm" | "scripted";
}

interface VoiceAssistantModalProps {
  mode: "fields" | "room-question";
  /** Required when mode is "fields". */
  fields?: VoiceFieldConfig[];
  /** Required when mode is "fields" - called with the transcript (already
   *  cleaned up per field kind) so the parent's real state stays the single
   *  source of truth. */
  onFieldChange?: (key: string, value: string) => void;
  onDone: () => void;
}

/**
 * Speech recognizers transcribe spoken emails badly - "john at gmail dot com"
 * comes back as literal words. Best-effort cleanup only; the value this
 * writes back is always visible and editable on the screen behind this modal.
 */
function spokenToEmail(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+dash\s+/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function applyKind(kind: VoiceFieldConfig["kind"], transcript: string): string {
  if (kind === "phone") return transcript.replace(/\D/g, "");
  if (kind === "email") return spokenToEmail(transcript);
  return transcript;
}

export function VoiceAssistantModal({ mode, fields = [], onFieldChange, onDone }: VoiceAssistantModalProps) {
  if (mode === "room-question") {
    return <RoomQuestionPanel onDone={onDone} />;
  }
  return <FieldFillPanel fields={fields} onFieldChange={onFieldChange} onDone={onDone} />;
}

function FieldFillPanel({
  fields,
  onFieldChange,
  onDone,
}: {
  fields: VoiceFieldConfig[];
  onFieldChange?: (key: string, value: string) => void;
  onDone: () => void;
}) {
  const { supported, listening, speak, listenOnce } = useSpeech();
  const [stepIndex, setStepIndex] = useState(0);
  const [heard, setHeard] = useState("");

  const step = fields[stepIndex];
  const isLastStep = stepIndex === fields.length - 1;

  useEffect(() => {
    if (!step) return;
    speak(step.prompt);
    setHeard("");
    // Only re-run when the step actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, fields.length]);

  if (!step) {
    return (
      <div className="panel">
        <h1 className="screen-title">All set</h1>
        <p className="screen-copy">There&apos;s nothing to fill in by voice on this screen.</p>
        <button className="primary-btn" onClick={onDone} type="button">
          Close
        </button>
      </div>
    );
  }

  async function handleListen() {
    const transcript = await listenOnce();
    if (!transcript) {
      setHeard("Didn't catch that - try again, or type it on the screen behind this.");
      return;
    }
    setHeard(`Heard: "${transcript}"`);
    onFieldChange?.(step.key, applyKind(step.kind, transcript));
  }

  return (
    <div className="panel">
      <h1 className="screen-title">{step.prompt}</h1>
      <p className="screen-copy">
        Field {stepIndex + 1} of {fields.length}: {step.label}
      </p>

      <div className="voice-orb">
        <button
          aria-label="Answer by voice"
          className={["voice-mic-btn", listening ? "listening" : ""].join(" ")}
          disabled={!supported}
          onClick={handleListen}
          type="button"
        >
          <Mic />
        </button>
      </div>

      <p className="voice-heard">
        {heard ||
          (supported
            ? "\u00A0"
            : "Voice input isn't supported here - use the keyboard on the screen behind this.")}
      </p>
      <p className="tiny-note">Current value: {step.value || "not set yet"}</p>

      <div className="screen-actions two">
        <button
          className="outline-btn"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          type="button"
        >
          Back
        </button>
        <button
          className="primary-btn"
          onClick={() => (isLastStep ? onDone() : setStepIndex((i) => i + 1))}
          type="button"
        >
          {isLastStep ? "Done" : "Next Field"}
        </button>
      </div>
    </div>
  );
}

function RoomQuestionPanel({ onDone }: { onDone: () => void }) {
  const { supported, listening, speak, listenOnce } = useSpeech();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await requestJson<RoomQuestionResponse>("/api/kiosk/room-question", {
        method: "POST",
        body: JSON.stringify({ question: trimmed }),
      });
      setAnswer(result.answer);
      speak(result.answer);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "I couldn't reach the room directory.";
      setError(message);
      speak("Sorry, I couldn't look that up right now.");
    } finally {
      setAsking(false);
    }
  }

  async function handleMic() {
    const transcript = await listenOnce();
    if (!transcript) return;
    setQuestion(transcript);
    void ask(transcript);
  }

  return (
    <div className="panel">
      <h1 className="screen-title">Ask about a room</h1>
      <p className="screen-copy">Try &ldquo;Is the Podcast Studio available?&rdquo;</p>

      <div className="voice-orb">
        <button
          aria-label="Ask by voice"
          className={["voice-mic-btn", listening ? "listening" : ""].join(" ")}
          disabled={!supported}
          onClick={handleMic}
          type="button"
        >
          <Mic />
        </button>
      </div>

      <label className="field">
        <span>Or type your question</span>
        <div className="input-wrap">
          <input
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void ask(question);
            }}
            placeholder="Is the Podcast Studio available?"
            value={question}
          />
        </div>
      </label>

      {asking ? <p className="tiny-note">Thinking...</p> : null}
      {answer ? <p className="voice-heard">{answer}</p> : null}
      {error ? <div className="status-banner error">{error}</div> : null}

      <button className="primary-btn" onClick={onDone} type="button">
        Done
      </button>
    </div>
  );
}