"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebSocket, tool, backgroundResult } from "@openai/agents/realtime";
import { z } from "zod";
import { X } from "lucide-react";
import { KioskButton } from "./KioskButton";

// PCM16 sample rate used throughout - both capture and playback contexts
// are created at this rate to avoid needing to resample. NOTE: not
// explicitly confirmed against OpenAI's Realtime API docs that exactly
// 24kHz is required for pcm16 - if audio sounds pitched wrong, check this
// first against the current API reference.
const PCM_SAMPLE_RATE = 24000;

// With barge-in enabled, the mic stays live even while the assistant is
// talking - which means its own voice bleeding back in (no headphones, or
// imperfect echo cancellation) can trigger a spurious speech_started/
// speech_stopped pair. A real utterance is essentially never this short,
// so anything shorter gets treated as noise/echo and ignored.
const MIN_REAL_SPEECH_MS = 400;

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

// Known room -> (service_type, zone_id) mapping, matching
// kiosk_flow_services.py's SERVICE_DEFAULTS. Update here if your actual
// zone ids differ.
const ROOM_MAP: Record<string, { service_type: string; zone_id: string }> = {
  meeting_room_1: { service_type: "meeting_room", zone_id: "MR_1" },
  meeting_room_2: { service_type: "meeting_room", zone_id: "MR_2" },
  podcast_studio: { service_type: "podcast_studio", zone_id: "POD_1" },
  tiktok_studio: { service_type: "tiktok_studio", zone_id: "TTS_1" },
};

// Next.js serves files under public/ at the root path WITHOUT a /public
// prefix (unlike the original Vite tester's paths) -- these point at
// public/images/{file} in inc-kiosk-frontend.
const ROOM_DISPLAY_INFO: Record<string, { label: string; imageUrl: string }> = {
  meeting_room_1: { label: "Meeting Room 1", imageUrl: "/images/meeting_rooms.jpg" },
  meeting_room_2: { label: "Meeting Room 2", imageUrl: "/images/meeting_rooms.jpg" },
  podcast_studio: { label: "Podcast Studio", imageUrl: "/images/podcast.jpg" },
  tiktok_studio: { label: "TikTok Studio", imageUrl: "/images/tiktok.png" },
};

type VoiceVisitor = {
  visitor_id: number;
  visitor_name: string;
  visitor_type: string;
};

type TranscriptLine = {
  id: number;
  kind: "user" | "assistant" | "tool";
  text: string;
};

type VoiceAssistantProps = {
  open: boolean;
  onClose: () => void;
  /**
   * A visitor already identified by the kiosk's face-recognition flow (or
   * manual lookup/registration). When present, the voice session
   * pre-authenticates as this visitor and skips the whole greeting /
   * name-and-phone collection flow, so someone the kiosk already knows
   * doesn't have to re-identify themselves by voice too.
   */
  knownVisitor?: VoiceVisitor | null;
};

function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    const s = int16Array[i];
    float32Array[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return float32Array;
}

// Mirrors normalize_phone_() in converse.py - always normalize before
// calling the backend, in case it validates phone format strictly.
function normalizePhoneForBackend(phone: string): string {
  const raw = (phone || "").trim();
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  const cleaned = raw.replace(/[^\d]/g, "").replace(/^0+/, "");
  return `+971${cleaned}`;
}

export function VoiceAssistant({ open, onClose, knownVisitor }: VoiceAssistantProps) {
  const [status, setStatus] = useState("idle");
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [currentVisitor, setCurrentVisitor] = useState<VoiceVisitor | null>(knownVisitor ?? null);
  const [roomPreview, setRoomPreview] = useState<{ label: string; imageUrl: string } | null>(null);

  // Mutable refs mirror the original module-level `let` variables --
  // needed because event/tool callbacks close over these and must always
  // see the CURRENT value, not the value from whichever render created
  // the closure.
  const sessionRef = useRef<RealtimeSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micEnabledRef = useRef(false);
  const mutedRef = useRef(false);
  const currentVisitorRef = useRef<VoiceVisitor | null>(knownVisitor ?? null);
  const conversationEndedRef = useRef(false);
  const turnAwaitingUserRef = useRef(true);
  const cancelledResponseIdsRef = useRef<Set<string>>(new Set());
  const speechStartedAtRef = useRef<number | null>(null);
  const lineIdRef = useRef(0);

  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const responseAudioStateRef = useRef<Map<string, { pending: number; done: boolean }>>(new Map());
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const awaitingPlaybackFinishRef = useRef(false);

  function appendLine(kind: TranscriptLine["kind"], text: string) {
    lineIdRef.current += 1;
    // Combine the counter with a random suffix so the key is unique even
    // if something (e.g. dev-mode double-invoked effects) ever causes two
    // lines to be appended in the same tick with the same counter value.
    const uniqueId = lineIdRef.current * 1_000_000 + Math.floor(Math.random() * 1_000_000);
    setTranscript((prev) => [...prev, { id: uniqueId, kind, text }]);
  }

  function appendToolLog(text: string) {
    appendLine("tool", `[tool] ${text}`);
  }

  function updateCurrentVisitor(visitor: VoiceVisitor | null) {
    currentVisitorRef.current = visitor;
    setCurrentVisitor(visitor);
  }

  // --- Playback bookkeeping ---------------------------------------------

  function getResponseState(responseId: string | undefined) {
    const key = responseId ?? "__unknown__";
    const map = responseAudioStateRef.current;
    if (!map.has(key)) {
      map.set(key, { pending: 0, done: false });
    }
    return map.get(key)!;
  }

  function allResponsesFinished(): boolean {
    for (const state of responseAudioStateRef.current.values()) {
      if (!state.done || state.pending > 0) return false;
    }
    return true;
  }

  function playPCM16Chunk(arrayBuffer: ArrayBuffer, responseId: string | undefined) {
    const ctx = playbackAudioContextRef.current;
    if (!ctx) return;
    const int16 = new Int16Array(arrayBuffer);
    const float32 = int16ToFloat32(int16);

    const audioBuffer = ctx.createBuffer(1, float32.length, PCM_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startAt = Math.max(nextPlayTimeRef.current, ctx.currentTime);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + audioBuffer.duration;

    const state = getResponseState(responseId);
    state.pending++;
    scheduledSourcesRef.current.add(source);

    source.onended = () => {
      scheduledSourcesRef.current.delete(source);
      state.pending = Math.max(0, state.pending - 1);
      if (allResponsesFinished()) {
        onPlaybackFullyFinished();
      }
    };
  }

  // Cuts off every chunk currently queued or playing, right now, instead
  // of letting already-scheduled Web Audio buffers run to completion
  // underneath an interruption.
  function flushQueuedPlayback() {
    for (const source of scheduledSourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped or never started - fine either way.
      }
    }
    scheduledSourcesRef.current.clear();
    if (playbackAudioContextRef.current) {
      nextPlayTimeRef.current = playbackAudioContextRef.current.currentTime;
    }
    responseAudioStateRef.current.clear();
  }

  function onPlaybackFullyFinished() {
    if (!awaitingPlaybackFinishRef.current) return;
    awaitingPlaybackFinishRef.current = false;
    responseAudioStateRef.current.clear();
    resumeAfterAssistantAudio();
  }

  function resumeAfterAssistantAudio() {
    if (conversationEndedRef.current) {
      micEnabledRef.current = false;
      appendToolLog("goodbye finished playing - stopping and disconnecting");
      setStatus("conversation ended - mic stopped");
      performDisconnect();
      return;
    }
    // Barge-in: the mic was never turned off for this response in the
    // first place, so there's nothing to re-enable here.
    turnAwaitingUserRef.current = true;
    setStatus(mutedRef.current ? "muted - assistant done talking" : "connected - your turn to talk");
  }

  // --- Mic capture --------------------------------------------------------

  async function setupMicCapture(activeSession: RealtimeSession) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micStreamRef.current = stream;
    const audioTrack = stream.getAudioTracks()[0];
    appendToolLog(`mic device in use: "${audioTrack?.label || "(no label - permission may be limited)"}"`);
    const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    micAudioContextRef.current = ctx;
    appendToolLog(`mic AudioContext actual sampleRate: ${ctx.sampleRate} (requested ${PCM_SAMPLE_RATE})`);
    await ctx.audioWorklet.addModule("/pcm-recorder-worklet.js");

    const micSource = ctx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(ctx, "pcm-recorder-processor");

    let sentChunkCount = 0;
    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!micEnabledRef.current) return;
      const int16 = float32ToInt16(event.data);
      try {
        activeSession.sendAudio(int16.buffer as ArrayBuffer);
        sentChunkCount++;
        // Log every 50th chunk (~roughly once a second) so we can SEE in
        // the transcript that mic audio is actually being captured and
        // sent, without flooding the log on every single 128-sample frame.
        if (sentChunkCount === 1 || sentChunkCount % 50 === 0) {
          let peak = 0;
          for (let i = 0; i < event.data.length; i++) {
            const abs = Math.abs(event.data[i]);
            if (abs > peak) peak = abs;
          }
          appendToolLog(
            `mic chunk #${sentChunkCount} sent (${int16.length} samples, peak amplitude ${peak.toFixed(4)})`
          );
        }
      } catch (err) {
        appendToolLog(`sendAudio failed: ${err}`);
        console.error("sendAudio failed:", err);
      }
    };

    // Deliberately NOT connecting workletNode to ctx.destination - we
    // don't want to hear our own mic played back locally.
    micSource.connect(workletNode);
  }

  function teardownMicCapture() {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (micAudioContextRef.current) {
      micAudioContextRef.current.close().catch(() => {});
      micAudioContextRef.current = null;
    }
  }

  // --- Backend calls --------------------------------------------------------

  async function fetchEphemeralKey(): Promise<string> {
    const res = await fetch(`${BACKEND_BASE_URL}/voice-agent/realtime-session`, { method: "POST" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to mint realtime session: ${res.status} - ${body}`);
    }
    const data = await res.json();
    if (!data.client_secret) {
      throw new Error("Backend didn't return a client_secret - check realtime_auth.py");
    }
    return data.client_secret;
  }

  async function fetchKnowledgeBase(): Promise<string> {
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/voice-agent/knowledge-base`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      return data.knowledge_base || "";
    } catch (err) {
      console.error("Failed to fetch knowledge base, falling back to a minimal placeholder:", err);
      return "(Knowledge base unavailable right now - if asked something you don't know, say you're not sure and suggest asking a reception associate.)";
    }
  }

  function showRoomPreview(room: string) {
    const info = ROOM_DISPLAY_INFO[room];
    if (!info) return;
    setRoomPreview(info);
  }

  // --- Tools --------------------------------------------------------------
  // Thin wrappers around the existing REST endpoints - all the actual
  // validation (duplicate phone numbers, etc.) lives there and is reused
  // as-is; these just give the model a way to call them.

  function buildTools() {
    const lookupVisitorTool = tool({
      name: "lookup_visitor",
      description:
        "Look up an existing customer by phone number to log them in. Only call this once " +
        "you have their phone number, and they've told you they're an existing customer. Full " +
        "name isn't collected for existing customers - omit it, don't ask for it just for this.",
      parameters: z.object({
        full_name: z.string().nullable().describe("The visitor's full name if you happen to have it, otherwise null - not collected for existing customers"),
        mobile_number: z.string().describe("The visitor's phone number, as given"),
      }),
      async execute({ full_name, mobile_number }: { full_name: string | null; mobile_number: string }) {
        const normalizedPhone = normalizePhoneForBackend(mobile_number);
        appendToolLog(`lookup_visitor(${full_name ?? "(no name given)"}, ${mobile_number} -> ${normalizedPhone})`);
        try {
          // NOTE: this endpoint (GET /api/kiosk/visitor-by-phone) was part
          // of the original tester as-ported -- verify it actually exists
          // in your current kiosk_flow.py; if it 404s, this is the first
          // place to check.
          const res = await fetch(
            `${BACKEND_BASE_URL}/api/kiosk/visitor-by-phone?mobile_number=${encodeURIComponent(normalizedPhone)}`
          );
          const body = await res.json().catch(() => ({}));
          if (res.ok && body?.data) {
            updateCurrentVisitor(body.data);
            appendToolLog(`found: ${body.data.visitor_name} (visitor_id ${body.data.visitor_id})`);
            return JSON.stringify({ found: true, visitor: body.data });
          }
          appendToolLog(`not found (status ${res.status})`);
          return JSON.stringify({
            found: false,
            message: "No profile found with that phone number - offer to register them instead.",
          });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ found: false, error: String(err) });
        }
      },
    });

    const registerVisitorTool = tool({
      name: "register_visitor",
      description:
        "Register a new visitor with their full name, phone number, visitor type, and email. " +
        "Only call this once you have all four - full name, whether they're a visitor or a " +
        "client, their email, and their phone number - and they've told you this is their " +
        "first time / they're not an existing customer.",
      parameters: z.object({
        full_name: z.string(),
        mobile_number: z.string(),
        email: z.string().nullable().describe("Email address - always asked for directly; null only if they genuinely refuse to give one"),
        visitor_type: z.enum(["visitor", "client"]).describe("Whichever they explicitly said when asked - don't default to one without asking"),
      }),
      async execute({ full_name, mobile_number, email, visitor_type }: {
        full_name: string; mobile_number: string; email: string | null; visitor_type: "visitor" | "client";
      }) {
        const normalizedPhone = normalizePhoneForBackend(mobile_number);
        appendToolLog(`register_visitor(${full_name}, ${mobile_number} -> ${normalizedPhone})`);
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/api/kiosk/profiles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              full_name,
              mobile_number: normalizedPhone,
              email: email || null,
              visitor_type: visitor_type || "visitor",
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (res.status === 201 && body?.data) {
            updateCurrentVisitor(body.data);
            appendToolLog(`registered: ${body.data.visitor_name} (visitor_id ${body.data.visitor_id})`);
            return JSON.stringify({ registered: true, visitor: body.data });
          }
          if (res.status === 409) {
            appendToolLog("conflict: phone already registered - should call lookup_visitor instead");
            return JSON.stringify({
              registered: false,
              conflict: true,
              message: "A profile with this phone number already exists - call lookup_visitor instead to log them in.",
            });
          }
          if (res.status === 422) {
            appendToolLog(`validation error: ${JSON.stringify(body?.details ?? body)}`);
            return JSON.stringify({
              registered: false,
              message:
                "That phone number couldn't be validated - it was likely misheard. Ask the visitor " +
                "to repeat their phone number slowly, one digit at a time, read it back to confirm, " +
                "then try again. Do not retry with the same number.",
            });
          }
          appendToolLog(`registration failed: ${body?.message || res.status}`);
          return JSON.stringify({ registered: false, message: body?.message || "Registration failed." });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ registered: false, error: String(err) });
        }
      },
    });

    const previewRoomTool = tool({
      name: "preview_room",
      description:
        "Show the visitor a picture of a room/service. Call this the MOMENT they mention or settle " +
        "on which room they want - don't wait until you've also collected the date, time, or " +
        "duration. Call it again if they change their mind about which room. Purely visual, doesn't " +
        "affect the booking itself.",
      parameters: z.object({
        room: z.enum(["meeting_room_1", "meeting_room_2", "podcast_studio", "tiktok_studio"])
          .describe("Which room/service to show a picture of"),
      }),
      async execute({ room }: { room: string }) {
        appendToolLog(`preview_room(${room})`);
        showRoomPreview(room);
        // Purely a client-side visual side effect - suppress the automatic
        // follow-up response the same way end_conversation does.
        return backgroundResult(JSON.stringify({ shown: true }));
      },
    });

    const createBookingTool = tool({
      name: "create_booking",
      description:
        "Book a meeting room, podcast studio, or TikTok studio for the signed-in visitor. Only call " +
        "this once you know which room/service, the date, the time, and the duration, and the visitor " +
        "is already signed in (via lookup_visitor or register_visitor).",
      parameters: z.object({
        room: z.enum(["meeting_room_1", "meeting_room_2", "podcast_studio", "tiktok_studio"])
          .describe("Which room or service to book"),
        date: z.string().describe("The date, in YYYY-MM-DD format"),
        time: z.string().describe("The start time, 24-hour format, e.g. '14:00'"),
        duration_minutes: z.number().describe("How long the booking is for, in minutes"),
      }),
      needsApproval: true,
      async execute({ room, date, time, duration_minutes }: {
        room: string; date: string; time: string; duration_minutes: number;
      }) {
        showRoomPreview(room); // belt-and-suspenders - preview_room should normally have shown this already
        const visitor = currentVisitorRef.current;
        if (!visitor) {
          appendToolLog("create_booking refused: no visitor signed in yet");
          return JSON.stringify({
            booked: false,
            message: "No visitor is signed in yet - log them in or register them first.",
          });
        }

        const mapping = ROOM_MAP[room];
        appendToolLog(`create_booking(${room}, ${date} ${time}, ${duration_minutes}min)`);
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/api/kiosk/bookings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              visitor_id: visitor.visitor_id,
              service_type: mapping.service_type,
              zone_id: mapping.zone_id,
              booking_date: date,
              booking_time_start: time,
              duration_minutes,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (res.status === 201 && body?.data) {
            appendToolLog(`booked: ${body.data.room_name} ${body.data.booking_time_start}-${body.data.booking_time_end}`);
            return JSON.stringify({ booked: true, booking: body.data });
          }
          appendToolLog(`booking failed (status ${res.status})`);
          return JSON.stringify({
            booked: false,
            message: body?.message || "That didn't work - please tell the visitor and offer to try a different time.",
            details: body?.details,
          });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ booked: false, error: String(err) });
        }
      },
    });

    const endConversationTool = tool({
      name: "end_conversation",
      description:
        "Call this once the visitor has clearly said they're finished and you're saying (or have " +
        "just said) your goodbye. This stops the assistant from listening for anything further - " +
        "only call it when the conversation is genuinely over, never mid-conversation.",
      parameters: z.object({}),
      async execute() {
        appendToolLog("end_conversation called - will stop listening once goodbye finishes playing");
        conversationEndedRef.current = true;
        return backgroundResult(JSON.stringify({ ended: true }));
      },
    });

    return [lookupVisitorTool, registerVisitorTool, createBookingTool, previewRoomTool, endConversationTool];
  }

  // --- Instructions ---------------------------------------------------------

  function buildInstructions(knowledgeBase: string, knownVisitor: VoiceVisitor | null): string {
    const today = new Date().toISOString().slice(0, 10);

    const greetingSection = knownVisitor
      ? `**Greeting.** ${knownVisitor.visitor_name} is ALREADY signed in (${knownVisitor.visitor_type === "client" ? "existing customer" : "new visitor"}) - do NOT ask for their name, email, phone, or customer status, you already have all of it. Just greet them warmly by name and ask how you can help.`
      : `**Greeting.** Greet the visitor warmly, briefly mention what you can help with (logging in or
registering, answering questions about Innovation City, and booking a meeting room, podcast
studio, or TikTok studio), and ask ONLY whether they're an existing customer or new here - nothing
else yet. What you ask next depends entirely on their answer (see below).`;

    const signInSection = knownVisitor
      ? ""
      : `
**Phone numbers are easy to mishear.** Read the phone number back to confirm before calling
lookup_visitor or register_visitor - same format they gave it in. Only call the tool once
confirmed; if wrong, re-listen and confirm again.

**Signing them in, once you know if they're an existing customer:**
- Existing customer -> ask ONLY for their phone number (nothing else - lookup works by phone
  alone). Found -> greet by name, logged in. Not found -> apologize, explain there's no profile
  under that number, and switch to the new-visitor flow below.
- New/not existing -> ask for all four together, not one at a time (only re-ask whatever's still
  missing): full name, whether they're a visitor or a client, their email, and their phone number.
  Then call register_visitor with visitor_type set to whichever they said.
  Conflict (phone already registered) -> call lookup_visitor instead.

Don't retry lookup_visitor/register_visitor with the same info - wait for something new first.
`;

    return `
You are a friendly voice assistant for Innovation City, a business hub in RAK. Your job is to
greet visitors, sign them in (log in an existing customer or register a new visitor), answer
questions, and help with bookings. Today's date is ${today}.

${greetingSection}

**Questions can come at any time.** No matter what you're in the middle of, answer a genuine
question right away using the knowledge base below - never defer it. Then pick back up exactly
where you left off.
${signInSection}
**Booking a room or service.** Once signed in, book via create_booking. You need:
- Which room/service - if "a meeting room" without specifying, ask which (there are two:
  meeting_room_1/meeting_room_2). Podcast/TikTok studio: only one each, don't ask which.
- Date, time, and duration in minutes.

The moment the room/service choice is settled - even before you've collected date, time, or
duration - call preview_room with it so the visitor sees a picture of it.

Gather whatever's missing across turns - don't demand everything at once. Call create_booking once
you have all four. Must be signed in first.

**Knowledge base - use this, and only this, for general questions.** If not covered here, say
you're not sure and suggest reception:

${knowledgeBase}

After completing a real task, ask if there's anything else. For a plain question, just answer it.
Only say goodbye when they clearly say they're finished, and when you do, call end_conversation.

**Keep every reply short - this is a voice conversation, not an essay.** One short sentence for most
turns; two at most for a list of facts they specifically asked for. If you catch yourself about to
say more than ~15-20 words, cut it down.

Be warm and professional, but brief - always.
`.trim();
  }

  // --- Connect / disconnect ---------------------------------------------------

  const connect = useCallback(async () => {
    setStatus("loading knowledge base…");
    conversationEndedRef.current = false;
    turnAwaitingUserRef.current = true;
    cancelledResponseIdsRef.current.clear();
    setTranscript([]);

    try {
      const knowledgeBase = await fetchKnowledgeBase();

      // Pre-authenticate with the face-recognized/looked-up visitor, if
      // any, same as the tester's simVisitorCheckbox shortcut -- skips the
      // whole greeting/collection flow (and its token cost) when the
      // kiosk already knows who this is.
      const startingVisitor = knownVisitor ?? null;
      updateCurrentVisitor(startingVisitor);

      setStatus("minting ephemeral token…");

      const agent = new RealtimeAgent({
        name: "Innovation City Assistant",
        instructions: buildInstructions(knowledgeBase, startingVisitor),
        tools: buildTools(),
      });

      const session = new RealtimeSession(agent, {
        model: "gpt-realtime-2.1",
        transport: new OpenAIRealtimeWebSocket(),
        config: {
          outputModalities: ["audio"],
          reasoning: { effort: "low" },
          audio: {
            input: {
              format: "pcm16",
              turnDetection: {
                type: "server_vad",
                threshold: 0.4,
                prefixPaddingMs: 300,
                silenceDurationMs: 600,
                createResponse: false,
                interruptResponse: true,
              },
            },
            output: { format: "pcm16" },
          },
        },
      });
      sessionRef.current = session;

      let prunedDuplicateGreeting = false;
      session.on("history_updated", (history: any[]) => {
        if (!prunedDuplicateGreeting) {
          const firstUserIndex = history.findIndex((item) => item.type === "message" && item.role === "user");
          const leadingAssistantMessages = history.filter(
            (item, idx) =>
              item.type === "message" &&
              item.role === "assistant" &&
              (firstUserIndex === -1 || idx < firstUserIndex)
          );
          if (leadingAssistantMessages.length > 1) {
            prunedDuplicateGreeting = true;
            const idsToRemove = new Set(leadingAssistantMessages.slice(1).map((item) => item.itemId ?? item.id));
            appendToolLog(`detected ${leadingAssistantMessages.length} greetings before any visitor input - pruning ${idsToRemove.size} duplicate(s)`);
            session.updateHistory((currentHistory: any[]) =>
              currentHistory.filter((item) => !idsToRemove.has(item.itemId ?? item.id))
            );
            return;
          }
        }

        // NOTE: unlike the original tester (which wiped and rebuilt one
        // shared DOM node from `history` on every update, silently
        // discarding any tool-log lines appended since), this keeps
        // transcript messages and tool-log lines as separate state so
        // tool logs don't disappear the next time history updates.
        const messageLines: TranscriptLine[] = [];
        for (const item of history) {
          if (item.type !== "message") continue;
          const text = (item.content || [])
            .map((c: any) => c.transcript || c.text || "")
            .filter(Boolean)
            .join(" ");
          if (text) {
            lineIdRef.current += 1;
            const uniqueId = lineIdRef.current * 1_000_000 + Math.floor(Math.random() * 1_000_000);
            messageLines.push({ id: uniqueId, kind: item.role === "user" ? "user" : "assistant", text });
          }
        }
        setTranscript((prev) => {
          const toolLines = prev.filter((line) => line.kind === "tool");
          return [...messageLines, ...toolLines].sort((a, b) => a.id - b.id);
        });
      });

      session.on("audio_interrupted", () => {
        flushQueuedPlayback();
        awaitingPlaybackFinishRef.current = false;
        appendToolLog("audio_interrupted - flushed queued playback");
        setStatus("interrupted - listening…");
        resumeAfterAssistantAudio();
      });

      // create_booking has needsApproval: true. window.confirm() is a
      // quick way to gate this without building custom approval UI -
      // swap for an in-app confirmation screen later if desired.
      session.on("tool_approval_requested", (_context: unknown, _agent: unknown, request: any) => {
        const approvalItem = request?.approvalItem ?? request;
        const toolName = approvalItem?.rawItem?.name ?? approvalItem?.name ?? "this action";
        const args = approvalItem?.rawItem?.arguments ?? approvalItem?.arguments ?? {};
        appendToolLog(`approval requested for ${toolName}: ${JSON.stringify(args)}`);

        if (toolName === "create_booking") {
          try {
            const parsedArgs = typeof args === "string" ? JSON.parse(args) : args;
            if (parsedArgs?.room) showRoomPreview(parsedArgs.room);
          } catch {
            // Malformed args JSON - not fatal, approval still works without a preview.
          }
        }

        const approved = window.confirm(`Approve ${toolName}?\n\n${JSON.stringify(args, null, 2)}`);
        if (approved) {
          session.approve(approvalItem);
          appendToolLog("approved");
        } else {
          session.reject(approvalItem);
          appendToolLog("rejected");
        }
      });

      session.on("error", (err: unknown) => {
        console.error("Realtime session error:", err);
        setStatus("error - check browser console");
      });

      session.on("audio", (event: any) => {
        if (cancelledResponseIdsRef.current.has(event?.responseId)) return;
        const chunk = event?.data ?? event?.audio ?? event?.buffer ?? event?.chunk ?? event;
        const usable = chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk);
        if (usable) {
          playPCM16Chunk(chunk instanceof ArrayBuffer ? chunk : (chunk.buffer as ArrayBuffer), event?.responseId);
        }
      });

      setStatus("connecting…");
      await session.connect({ apiKey: fetchEphemeralKey });

      setStatus("setting up microphone…");
      playbackAudioContextRef.current = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      nextPlayTimeRef.current = playbackAudioContextRef.current.currentTime;
      await setupMicCapture(session);

      setStatus("connected - greeting…");
      setConnected(true);

      // Barge-in: mic stays live from connect through every response -
      // the only things that turn it off are manual mute and disconnect.
      micEnabledRef.current = true;
      mutedRef.current = false;
      setMuted(false);

      let speechStartedAt: number | null = null;
      (session.transport as any).on("*", (event: any) => {
        if (event?.type === "response.created") {
          const responseId = event?.response?.id;
          if (turnAwaitingUserRef.current) {
            appendToolLog(`unrequested response ${responseId} detected before the visitor's turn - cancelling it`);
            cancelledResponseIdsRef.current.add(responseId);
            try {
              (session.transport as any).sendEvent({ type: "response.cancel", response_id: responseId });
            } catch (err) {
              console.error("Could not cancel unrequested response:", err);
            }
            getResponseState(responseId).done = true;
            return;
          }
          setStatus("assistant speaking…");
          awaitingPlaybackFinishRef.current = true;
          getResponseState(responseId);
        } else if (event?.type === "response.done") {
          const responseId = event?.response?.id;
          const state = getResponseState(responseId);
          state.done = true;
          if (allResponsesFinished()) {
            onPlaybackFullyFinished();
          }
        } else if (event?.type === "input_audio_buffer.speech_started") {
          speechStartedAt = performance.now();
          speechStartedAtRef.current = speechStartedAt;
          appendToolLog("speech_started detected by VAD");
        } else if (event?.type === "input_audio_buffer.speech_stopped") {
          const startedAt = speechStartedAtRef.current;
          const durationMs = startedAt === null ? Infinity : performance.now() - startedAt;
          speechStartedAtRef.current = null;
          if (durationMs < MIN_REAL_SPEECH_MS) {
            appendToolLog(`ignoring ${durationMs.toFixed(0)}ms speech blip (below ${MIN_REAL_SPEECH_MS}ms) - likely echo/noise`);
            return;
          }
          turnAwaitingUserRef.current = false;
          try {
            (session.transport as any).sendEvent({ type: "response.create" });
          } catch (err) {
            console.error("Could not trigger response after speech_stopped:", err);
          }
        }
      });

      // Ask for the opening greeting ourselves - VAD only triggers a
      // response once it hears the visitor's voice, so without this the
      // session would sit there silently until someone talks.
      turnAwaitingUserRef.current = false;
      try {
        (session.transport as any).sendEvent({ type: "response.create" });
      } catch (err) {
        console.error("Could not trigger initial greeting:", err);
      }
    } catch (err) {
      console.error(err);
      setStatus("failed to connect - check browser console");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownVisitor]);

  function performDisconnect() {
    const session = sessionRef.current as any;
    session?.close?.() ?? session?.disconnect?.();
    sessionRef.current = null;
    teardownMicCapture();
    if (playbackAudioContextRef.current) {
      playbackAudioContextRef.current.close().catch(() => {});
      playbackAudioContextRef.current = null;
    }
    awaitingPlaybackFinishRef.current = false;
    responseAudioStateRef.current.clear();
    scheduledSourcesRef.current.clear();
    cancelledResponseIdsRef.current.clear();
    updateCurrentVisitor(null);
    conversationEndedRef.current = false;
    setRoomPreview(null);
    setConnected(false);
    setMuted(false);
  }

  function handleToggleMute() {
    if (!sessionRef.current) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    micEnabledRef.current = !next;
    setMuted(next);
    setStatus(next ? "muted" : "connected - just start talking");
  }

  function handleDisconnect() {
    if (!sessionRef.current) {
      onClose();
      return;
    }
    performDisconnect();
    setStatus("disconnected");
    onClose();
  }

  // Connect the moment the modal opens; tear down when it closes or the
  // component unmounts, so leaving the voice screen always cleans up mic/
  // audio resources even if the visitor didn't explicitly hang up.
  useEffect(() => {
    if (open && !sessionRef.current) {
      connect();
    }
    if (!open && sessionRef.current) {
      performDisconnect();
    }
    return () => {
      if (sessionRef.current) {
        performDisconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-6">
      <div className="w-full max-w-lg rounded-md border border-cyan/30 bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan">Voice assistance</p>
            <h2 className="mt-2 text-2xl font-semibold">{status}</h2>
            {currentVisitor ? (
              <p className="mt-1 text-sm text-white/60">
                Signed in as {currentVisitor.visitor_name} ({currentVisitor.visitor_type})
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close voice assistance"
            className="grid h-10 w-10 place-items-center rounded-md border border-white/15 bg-white/8"
            onClick={handleDisconnect}
            title="Close"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {roomPreview ? (
          <div className="mt-4 overflow-hidden rounded-md" style={{ aspectRatio: "16/9", maxHeight: "220px" }}>
            <img
              key={roomPreview.imageUrl}
              alt={roomPreview.label}
              src={roomPreview.imageUrl}
              className="h-full w-full object-cover"
              style={{ animation: "voice-room-fade-in 0.4s ease" }}
            />
            <p className="mt-2 text-center text-sm text-white/60">{roomPreview.label}</p>
          </div>
        ) : null}

        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-white/5 p-3 text-sm">
          {transcript.length === 0 ? (
            <p className="text-white/40">Say hello to get started…</p>
          ) : (
            transcript.map((line) => (
              <p
                key={line.id}
                className={
                  line.kind === "tool"
                    ? "italic text-white/40"
                    : line.kind === "user"
                      ? "text-cyan"
                      : "text-white"
                }
              >
                {line.kind === "tool" ? line.text : `${line.kind === "user" ? "You" : "Assistant"}: ${line.text}`}
              </p>
            ))
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <KioskButton className="flex-1" onClick={handleToggleMute} variant="secondary">
            {muted ? "Unmute" : "Mute"}
          </KioskButton>
          <KioskButton className="flex-1" onClick={handleDisconnect} variant="ghost">
            End Conversation
          </KioskButton>
        </div>
      </div>
      <style jsx>{`
        @keyframes voice-room-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}