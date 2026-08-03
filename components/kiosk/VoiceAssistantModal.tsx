"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { ApiRequestError, requestJson } from "@/lib/api";
import { useSpeech } from "@/hooks/usespeech";

export interface VoiceFieldConfig {
  key: string;
  label: string;
  prompt: string;
  value: string;
  kind?: "text" | "email" | "phone" | "notes";
}

interface RoomQuestionResponse {
  answer: string;
  source: "llm" | "scripted";
}

export interface VoiceAssistantModalProps {
  mode: "fields" | "room-question";
  visitorId?: number | null;
  fields?: VoiceFieldConfig[];
  onFieldChange?: (key: string, value: string) => void;
  combinedIntakeEndpoint?: string;
  combinedIntakePrompt?: string;
  combinedIntakePayload?: Record<string, unknown>;
  onDone: () => void;
  // New for server agent
  agentPayload?: Record<string, unknown>;
  agentEndpoint?: string;
  agentFieldMapping?: {
    name: string;
    email: string;
    existingCustomer: string;
    phone: string;
  };
  onExtracted?: (data: { name: string; email: string; existingCustomer: boolean; phone?: string }) => void;
}

// Helper: spoken email cleanup
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

function valueFromResponse(payload: Record<string, unknown>, fieldKey: string): string | null {
  const aliases: Record<string, string[]> = {
    zone_id: ["zone_id", "zoneId", "room_id", "room"],
    booking_date: ["booking_date", "date", "bookingDate"],
    booking_time_start: ["booking_time_start", "time", "bookingTimeStart", "booking_time"],
    duration_minutes: ["duration_minutes", "duration", "durationMinutes"],
  };

  const maybeNested = payload.data;
  const source = (maybeNested && typeof maybeNested === "object" ? maybeNested : payload) as Record<string, unknown>;

  for (const alias of aliases[fieldKey] ?? [fieldKey]) {
    const candidate = source[alias];
    if (typeof candidate === "string" || typeof candidate === "number") {
      const text = String(candidate).trim();
      if (text) return text;
    }
  }
  return null;
}

function toDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ===== ServerAgentPanel (uses the new REST endpoints) =====
function ServerAgentPanel({
  agentEndpoint,
  agentPayload,
  fields,
  onFieldChange,
  onDone,
  onExtracted,
  agentFieldMapping = { name: "full_name", email: "email", existingCustomer: "visitor_type", phone: "mobile_number" },
}: {
  agentEndpoint: string;
  agentPayload?: Record<string, unknown>;
  fields: VoiceFieldConfig[];
  onFieldChange?: (key: string, value: string) => void;
  onDone: () => void;
  onExtracted?: (data: { name: string; email: string; existingCustomer: boolean; phone?: string }) => void;
  agentFieldMapping?: { name: string; email: string; existingCustomer: string; phone: string };
}) {
  const [status, setStatus] = useState<"idle" | "recording" | "processing" | "done" | "error">("idle");
  const [replyText, setReplyText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = handleRecordingStop;
      recorder.start();
      mediaRecorderRef.current = recorder;
      setStatus("recording");
      setReplyText("");
      setErrorMsg("");
    } catch {
      setStatus("error");
      setErrorMsg("Microphone access denied. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleRecordingStop = async () => {
    setStatus("processing");
    const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64data = (reader.result as string).split(",")[1];
      const payload: any = { audio: base64data, mime_type: "audio/webm",...agentPayload};
      if (sessionId) payload.session_id = sessionId;

      try {
        const response = await fetch(agentEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
          setStatus("error");
          setErrorMsg(data.detail || "Server error");
          return;
        }

        if (data.session_id) setSessionId(data.session_id);

        // Play TTS audio if available
        if (data.reply_audio) {
          const audioBytes = Uint8Array.from(atob(data.reply_audio), (c) => c.charCodeAt(0));
          const blob = new Blob([audioBytes], { type: data.audio_content_type || "audio/wav" });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.play();
        }

        setReplyText(data.reply_text);

        if (data.registered) {
          const extracted = data.extracted;
          if (extracted) {
            const map = agentFieldMapping;
            if (extracted.full_name) onFieldChange?.(map.name, extracted.full_name);
            if (extracted.email) onFieldChange?.(map.email, extracted.email);
            if (extracted.mobile_number) onFieldChange?.(map.phone, extracted.mobile_number);
            if (extracted.visitor_type) {
              const val = extracted.visitor_type === "client" ? "client" : "visitor";
              onFieldChange?.(map.existingCustomer, val);
            }
            const bookingData: any = {};
          if (extracted.zone_id) bookingData.zone_id = extracted.zone_id;
          if (extracted.date) bookingData.date = extracted.date;
          if (extracted.time) bookingData.time = extracted.time;
          if (extracted.duration_minutes) bookingData.duration_minutes = extracted.duration_minutes;

            onExtracted?.({
              name: extracted.full_name,
              email: extracted.email,
              existingCustomer: extracted.visitor_type === "client",
              phone: extracted.mobile_number,
              ...bookingData,
            });
          }
          setStatus("done");
          setTimeout(onDone, 1500);
        } else {
          setStatus("idle");
        }
      } catch {
        setStatus("error");
        setErrorMsg("Network error. Please try again.");
      }
    };
    reader.readAsDataURL(audioBlob);
  };

  const handleRetry = () => {
    chunksRef.current = [];
    startRecording();
  };

  return (
    <div className="panel">
      <h1 className="screen-title">
        {status === "recording"
          ? "Listening..."
          : status === "processing"
          ? "Processing..."
          : status === "done"
          ? "✅ Done!"
          : "Voice Assistant"}
      </h1>
      <p className="screen-copy">
        {status === "recording"
          ? "Speak your name, email, phone, and whether you are an existing customer."
          : status === "idle"
          ? replyText || "Say your details, or press 'Record' to try again."
          : status === "error"
          ? errorMsg
          : ""}
      </p>

      <div className="voice-orb">
        {status === "recording" && (
          <button className="primary-btn" onClick={stopRecording} type="button">
            Stop & Send
          </button>
        )}
        {status === "idle" && (
          <button className="primary-btn" onClick={handleRetry} type="button">
            Record Again
          </button>
        )}
        {status === "error" && (
          <button className="primary-btn" onClick={handleRetry} type="button">
            Retry
          </button>
        )}
        {status === "processing" && <span>⏳</span>}
        {status === "done" && <span>✅</span>}
      </div>

      <div className="screen-actions two">
        <button className="outline-btn" onClick={onDone} type="button">
          Fill Manually
        </button>
        {status === "idle" && (
          <button className="primary-btn" onClick={handleRetry} type="button">
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}

// ===== FieldFillPanel (existing combined intake) =====
function FieldFillPanel({
  fields,
  onFieldChange,
  combinedIntakeEndpoint,
  combinedIntakePrompt,
  combinedIntakePayload,
  onDone,
  visitorId,
}: {
  fields: VoiceFieldConfig[];
  onFieldChange?: (key: string, value: string) => void;
  combinedIntakeEndpoint?: string;
  combinedIntakePrompt?: string;
  combinedIntakePayload?: Record<string, unknown>;
  onDone: () => void;
  visitorId?: number | null;
}) {
  const { supported, listening, speak, listenOnce } = useSpeech();
  const [stage, setStage] = useState<"combined" | "follow-up" | "per-field">(
    combinedIntakeEndpoint ? "combined" : "per-field"
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [heard, setHeard] = useState("");
  const [combinedBusy, setCombinedBusy] = useState(false);
  const [combinedError, setCombinedError] = useState<string | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState<string | null>(null);
  const step = fields[stepIndex];
  const isLastStep = stepIndex === fields.length - 1;

  useEffect(() => {
    if (stage !== "combined" || !combinedIntakeEndpoint) return;
    speak(combinedIntakePrompt || "Tell me whatever you want to share.");
  }, [stage]);

  async function handleCombinedListen() {
    const transcript = await listenOnce(15000);
    if (!transcript) {
      setCombinedError("Didn't catch that - try again.");
      return;
    }
    if (/^\s*skip\s*$/i.test(transcript)) {
      setStage("per-field");
      return;
    }
    await parseAndFillTranscript(transcript);
  }

  async function handleFollowUpListen() {
    const transcript = await listenOnce(15000);
    if (!transcript) {
      setCombinedError("Didn't catch that - try again.");
      return;
    }
    if (/^\s*skip\s*$/i.test(transcript)) {
      setStage("per-field");
      return;
    }
    await parseAndFillTranscript(transcript);
  }

  async function parseAndFillTranscript(transcript: string) {
    if (!combinedIntakeEndpoint) return;
    setCombinedBusy(true);
    setCombinedError(null);
    setFollowUpMessage(null);
    try {
      const response = await requestJson<Record<string, unknown>>(combinedIntakeEndpoint, {
        method: "POST",
        body: JSON.stringify({ transcript, ...(combinedIntakePayload ?? {}) }),
      });
      const filledKeys = new Set<string>();
      const payloadForMapping = response.data ?? response;
      for (const field of fields) {
        const value = valueFromResponse(payloadForMapping as Record<string, unknown>, field.key);
        if (value !== null) {
          onFieldChange?.(field.key, value);
          filledKeys.add(field.key);
        }
      }
      const missingFields = fields.filter((f) => !filledKeys.has(f.key));
      if (missingFields.length === 0) {
        speak("I have everything. Ready to continue.");
        onDone();
        return;
      }
      const missingLabels = missingFields.map((f) => f.label).join(", ");
      const nextPrompt = `I still need ${missingLabels}. Tell me the missing details, or say skip.`;
      setFollowUpMessage(nextPrompt);
      setStage("follow-up");
      speak(nextPrompt);
    } catch (err) {
      setCombinedError(err instanceof ApiRequestError ? err.message : "Couldn't process that.");
    } finally {
      setCombinedBusy(false);
    }
  }

  if (stage === "combined" && combinedIntakeEndpoint) {
    return (
      <div className="panel panel-compact">
        <h1 className="screen-title">
          {combinedIntakePrompt || "Tell me whatever you want to share."}
        </h1>
        <div className="voice-orb">
          <button
            className={["voice-mic-btn", listening ? "listening" : ""].join(" ")}
            disabled={!supported || combinedBusy}
            onClick={handleCombinedListen}
            type="button"
          >
            <Mic />
          </button>
        </div>
        <p className="voice-heard">
          {combinedBusy
            ? "One moment..."
            : combinedError || followUpMessage || (supported ? "\u00A0" : "Voice input not supported.")}
        </p>
        <div className="screen-actions two">
          <button className="outline-btn" onClick={() => { setCombinedError(null); }} type="button">
            Try Again
          </button>
          <button className="primary-btn" onClick={onDone} type="button">
            Fill Manually
          </button>
        </div>
      </div>
    );
  }

  if (stage === "follow-up" && combinedIntakeEndpoint) {
    return (
      <div className="panel panel-compact">
        <h1 className="screen-title">I still need a few details</h1>
        <div className="voice-orb">
          <button
            className={["voice-mic-btn", listening ? "listening" : ""].join(" ")}
            disabled={!supported || combinedBusy}
            onClick={handleFollowUpListen}
            type="button"
          >
            <Mic />
          </button>
        </div>
        <p className="voice-heard">
          {combinedBusy
            ? "One moment..."
            : combinedError || followUpMessage || "\u00A0"}
        </p>
        <div className="screen-actions two">
          <button className="outline-btn" onClick={() => setStage("per-field")} type="button">
            Fill Manually
          </button>
          <button className="primary-btn" onClick={onDone} type="button">
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!step) return <div>No fields</div>;

  async function handleListen() {
    const transcript = await listenOnce();
    if (!transcript) {
      setHeard("Didn't catch that – try again.");
      return;
    }
    setHeard(`Heard: "${transcript}"`);
    onFieldChange?.(step.key, applyKind(step.kind, transcript));
    speak(`Got it. I captured ${step.label}.`);
    if (isLastStep) {
      onDone();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  return (
    <div className="panel">
      <h1 className="screen-title">{step.prompt}</h1>
      <p className="screen-copy">
        Field {stepIndex + 1} of {fields.length}: {step.label}
      </p>
      <div className="voice-orb">
        <button
          className={["voice-mic-btn", listening ? "listening" : ""].join(" ")}
          disabled={!supported}
          onClick={handleListen}
          type="button"
        >
          <Mic />
        </button>
      </div>
      <p className="voice-heard">{heard || (supported ? "\u00A0" : "Voice input not supported.")}</p>
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

// ===== RoomQuestionPanel (existing) =====
function RoomQuestionPanel({ onDone, visitorId }: { onDone: () => void; visitorId?: number | null }) {
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
        body: JSON.stringify({ question: trimmed, visitor_id: visitorId ?? null }),
      });
      setAnswer(result.answer);
      speak(result.answer);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Couldn't reach the assistant service.";
      setError(message);
      speak("Sorry, I couldn't help right now.");
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
    <div className="panel panel-compact">
      <h1 className="screen-title">Voice Assistant</h1>
      <p className="screen-copy">Ask about facilities, rooms, bookings, or help with the kiosk.</p>
      <div className="voice-orb">
        <button
          className={["voice-mic-btn", listening ? "listening" : ""].join(" ")}
          disabled={!supported}
          onClick={handleMic}
          type="button"
        >
          <Mic />
        </button>
      </div>
      <label className="field">
        <span>Or type your request</span>
        <div className="input-wrap">
          <input
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void ask(question); }}
            placeholder="Tell me about the Podcast Studio"
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

// ===== Main export =====
export function VoiceAssistantModal({
  mode,
  visitorId,
  fields = [],
  onFieldChange,
  combinedIntakeEndpoint,
  combinedIntakePrompt,
  combinedIntakePayload,
  agentPayload,
  onDone,
  agentEndpoint,
  agentFieldMapping,
  onExtracted,
}: VoiceAssistantModalProps) {
  if (mode === "room-question") {
    return <RoomQuestionPanel onDone={onDone} visitorId={visitorId} />;
  }

  if (agentEndpoint) {
    return (
      <ServerAgentPanel
        agentEndpoint={agentEndpoint}
        agentPayload={agentPayload}
        fields={fields}
        onFieldChange={onFieldChange}
        onDone={onDone}
        onExtracted={onExtracted}
        agentFieldMapping={agentFieldMapping}
      />
    );
  }

  return (
    <FieldFillPanel
      fields={fields}
      onFieldChange={onFieldChange}
      combinedIntakeEndpoint={combinedIntakeEndpoint}
      combinedIntakePrompt={combinedIntakePrompt}
      combinedIntakePayload={combinedIntakePayload}
      onDone={onDone}
      visitorId={visitorId}
    />
  );
}