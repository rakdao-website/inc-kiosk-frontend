"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, tool, backgroundResult } from "@openai/agents/realtime";
import { z } from "zod";
import { Mic, MicOff, X } from "lucide-react";
import { KioskButton } from "./KioskButton";

// With barge-in enabled, the mic stays live even while the assistant is
// talking - which means its own voice bleeding back in (no headphones, or
// imperfect echo cancellation) can trigger a spurious speech_started/
// speech_stopped pair. A real utterance is essentially never this short,
// so anything shorter gets treated as noise/echo and ignored.
const MIN_REAL_SPEECH_MS = 400;

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

// The one fixed line the assistant must say right before ending every call.
// Edit CLOSING_TAGLINE directly to change it -- it's enforced in the prompt
// (buildInstructions below), not left up to the model to remember on its own.
const CLOSING_TAGLINE = "Built by Ayah and Dima, two AI engineers so good, we should be illegal. We're open to opportunities, so if you're hiring... this is your sign!";
const CLOSING_LINE = `Goodbye, and thank you for visiting - ${CLOSING_TAGLINE}`;

// response.done means the model finished GENERATING the closing line, not
// that the audio has finished PLAYING -- there's a real gap between those,
// and it grows with how long CLOSING_LINE is. Disconnecting on response.done
// alone cuts the audio off mid-sentence. This estimates how long the line
// takes to speak so we can wait that long before tearing down the session.
function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const WORDS_PER_SECOND = 2.5; // conservative on purpose -- better to wait
  // slightly too long (a beat of silence) than cut audio off early.
  return Math.round((words / WORDS_PER_SECOND) * 1000) + 1200; // + playback/network cushion
}

const CLOSING_LINE_SPEECH_MS = estimateSpeechMs(CLOSING_LINE);

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
  meeting_room_1: { label: "Meeting Room 1", imageUrl: "/images/meeting_room1.jpeg" },
  meeting_room_2: { label: "Meeting Room 2", imageUrl: "/images/meeting_room2.jpeg" },
  podcast_studio: { label: "Podcast Studio", imageUrl: "/images/podcast_studio.jpeg" },
  tiktok_studio: { label: "TikTok Studio", imageUrl: "/images/tiktok_studio.jpeg" },
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
  /**
   * Called right after a brand-new visitor is registered by voice, to
   * capture their face photos and save them via the same camera-capture +
   * /api/kiosk/face-profile logic the manual kiosk flow uses (see
   * page.tsx's captureFaceSamples + enrollFaceForVisitor). Awaited inside
   * the register_visitor tool call itself -- since the agent doesn't
   * generate its next reply until the tool returns, this naturally pauses
   * the conversation while the photo is taken and saved. If omitted, voice
   * registration completes without any face enrollment step.
   */
  onNeedFaceEnrollment?: (visitor: VoiceVisitor) => Promise<void>;
};

// Mirrors normalize_phone_() in converse.py - always normalize before
// calling the backend, in case it validates phone format strictly.
function normalizePhoneForBackend(phone: string): string {
  const raw = (phone || "").trim();
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  const cleaned = raw.replace(/[^\d]/g, "").replace(/^0+/, "");
  return `+971${cleaned}`;
}

export function VoiceAssistant({ open, onClose, knownVisitor, onNeedFaceEnrollment }: VoiceAssistantProps) {
  const [status, setStatus] = useState("idle");
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [currentVisitor, setCurrentVisitor] = useState<VoiceVisitor | null>(knownVisitor ?? null);
  const [roomPreview, setRoomPreview] = useState<{ label: string; imageUrl: string } | null>(null);

  // Mutable refs mirror the original module-level `let` variables --
  // needed because event/tool callbacks close over these and must always
  // see the CURRENT value, not the value from whichever render created
  // the closure.
  const sessionRef = useRef<RealtimeSession | null>(null);
  const mutedRef = useRef(false);
  const currentVisitorRef = useRef<VoiceVisitor | null>(knownVisitor ?? null);
  const conversationEndedRef = useRef(false);
  const turnAwaitingUserRef = useRef(true);
  const cancelledResponseIdsRef = useRef<Set<string>>(new Set());
  const speechStartedAtRef = useRef<number | null>(null);
  const lineIdRef = useRef(0);
  const onNeedFaceEnrollmentRef = useRef(onNeedFaceEnrollment);
  useEffect(() => {
    onNeedFaceEnrollmentRef.current = onNeedFaceEnrollment;
  }, [onNeedFaceEnrollment]);

  // Rendered but not necessarily wired up to anything -- under WebRTC the
  // SDK is expected to handle attaching/playing the remote audio track
  // automatically. This element exists as a fallback attach point to
  // inspect/use if audio turns out to be silent after connecting; see the
  // NOTE in connect() below.
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function resumeAfterAssistantAudio() {
    if (conversationEndedRef.current) {
      appendToolLog(
        `goodbye finished generating - waiting ~${CLOSING_LINE_SPEECH_MS}ms for playback to catch up before disconnecting`,
      );
      setStatus("saying goodbye…");
      closingTimeoutRef.current = setTimeout(() => {
        closingTimeoutRef.current = null;
        appendToolLog("goodbye playback should be done - disconnecting");
        setStatus("conversation ended");
        performDisconnect();
      }, CLOSING_LINE_SPEECH_MS);
      return;
    }
    turnAwaitingUserRef.current = true;
    setStatus(mutedRef.current ? "muted - assistant done talking" : "connected - your turn to talk");
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
        "first time / they're not an existing customer. This may also silently capture a photo " +
        "for face recognition on future visits -- if the result includes " +
        "face_photo_saved: true, briefly mention in your next reply that you've saved their " +
        "photo so the kiosk will recognize them next time.",
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

            // Pause here for face capture, if the parent page wired it up.
            // The agent won't generate its next spoken reply until this
            // tool call returns, so awaiting this IS the pause -- no
            // separate state machine needed. See the prop's doc comment
            // for the honest limitation: the agent can't say "look at the
            // camera" mid-pause, only confirm it's done afterward.
            if (onNeedFaceEnrollmentRef.current) {
              appendToolLog("capturing face photo for enrollment…");
              setStatus("registered — capturing your photo, please look at the camera…");
              try {
                await onNeedFaceEnrollmentRef.current(body.data);
                appendToolLog("face photo saved");
              } catch (enrollErr) {
                // Non-fatal: registration itself already succeeded. Log it
                // and let the model's reply proceed without mentioning a
                // saved photo, rather than failing the whole registration.
                appendToolLog(`face enrollment failed (registration still saved): ${enrollErr}`);
              }
              setStatus("assistant speaking…");
            }

            return JSON.stringify({
              registered: true,
              visitor: body.data,
              face_photo_saved: Boolean(onNeedFaceEnrollmentRef.current),
            });
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
        "Call this ONLY after you have already spoken the full mandatory closing line word-for-word " +
        "(see 'Ending the call' in your instructions). Never call it before or while still speaking " +
        "that line, and never call it mid-conversation - only once the visitor is clearly finished " +
        "and the complete closing line has already been said out loud.",
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

**Ending the call.** Only once the visitor clearly says they're finished:
1. Say this exact closing line, word-for-word, as ONE line - never shorten it, paraphrase it, split
   it up, or replace it with a shorter goodbye like "alright" or "bye": "${CLOSING_LINE}"
2. Only after that entire line has been spoken out loud, call end_conversation. Never call it
   before or during that line.

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
        transport: new OpenAIRealtimeWebRTC(),
        config: {
          outputModalities: ["audio"],
          reasoning: { effort: "low" },
          audio: {
            input: {
              format: "pcm16",
              // NOTE: not confirmed against current OpenAI Realtime API
              // docs for this exact SDK version/model -- this is meant to
              // suppress background/distant voices, tuned for a visitor
              // standing close to a kiosk mic (as opposed to "far_field",
              // meant for a mic across a room). If this causes a connection
              // error, it's the first thing to remove.
              noiseReduction: { type: "near_field" },
              turnDetection: {
                type: "server_vad",
                // Raised back up from the 0.4 used while diagnosing a dead
                // mic -- now that the mic itself is confirmed working, a
                // higher threshold requires louder/closer speech to trigger,
                // which is exactly what filters out other people talking
                // nearby. Retune if it's still too sensitive (try 0.7) or
                // starts missing your own quieter speech (try 0.5).
                threshold: 0.6,
                prefixPaddingMs: 300,
                // One more conservative step down from 500ms. Test with
                // normal fluent sentences (not digit-by-digit numbers,
                // which is what broke 280ms earlier) -- if a mid-sentence
                // pause starts getting cut off again, go back to 500. Set
                // realistic expectations either way: a meaningful chunk of
                // remaining delay is the model's own thinking + speech
                // generation time, which no value here can remove.
                silenceDurationMs: 400,
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

      // Simplified from the WebSocket version -- there's no manual chunk
      // queue to flush anymore, the SDK/browser owns audio playback.
      session.on("audio_interrupted", () => {
        appendToolLog("audio_interrupted");
        setStatus("interrupted - listening…");
        setIsUserSpeaking(false);
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

      setStatus("connecting…");
      // NOTE: under WebRTC, this should trigger the browser's own mic
      // permission prompt and set up the peer connection automatically. If
      // connection succeeds but you hear NOTHING when the assistant
      // replies, that's the single most likely thing to have gone wrong --
      // the remote audio track may need to be manually attached to
      // audioElementRef.current instead of relying on automatic playback.
      // Check the browser console for any WebRTC/ICE errors first.
      await session.connect({ apiKey: fetchEphemeralKey });

      setStatus("connected - greeting…");
      setConnected(true);
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
            return;
          }
          setStatus("assistant speaking…");
        } else if (event?.type === "response.done") {
          // Simplified from the WebSocket version's pending-chunk tracking
          // -- response.done is used directly as "assistant's turn is
          // over" under WebRTC, since we no longer see individual audio
          // chunks to count. This may flip back to "your turn" slightly
          // before trailing audio finishes playing; if that causes the
          // visitor's next utterance to get missed at the very start,
          // that's the trade-off to know about.
          resumeAfterAssistantAudio();
        } else if (event?.type === "input_audio_buffer.speech_started") {
          speechStartedAt = performance.now();
          speechStartedAtRef.current = speechStartedAt;
          setIsUserSpeaking(true);
        } else if (event?.type === "input_audio_buffer.speech_stopped") {
          setIsUserSpeaking(false);
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
    if (closingTimeoutRef.current) {
      clearTimeout(closingTimeoutRef.current);
      closingTimeoutRef.current = null;
    }
    const session = sessionRef.current as any;
    session?.close?.() ?? session?.disconnect?.();
    sessionRef.current = null;
    cancelledResponseIdsRef.current.clear();
    updateCurrentVisitor(null);
    conversationEndedRef.current = false;
    setRoomPreview(null);
    setConnected(false);
    setMuted(false);
    setIsUserSpeaking(false);
  }

  function handleToggleMute() {
    if (!sessionRef.current) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    setStatus(next ? "muted" : "connected - just start talking");
    if (next) setIsUserSpeaking(false);
    // ASSUMPTION: RealtimeSession exposes a mute() method for WebRTC mode,
    // since we no longer have direct access to the mic stream/track
    // ourselves. If muting doesn't actually silence the mic (check the
    // browser's mic-active indicator), this method name needs correcting
    // against the actual SDK -- likely candidates: session.mute(),
    // session.transport.mute(), or toggling .enabled on a track exposed
    // somewhere on the session/transport object.
    try {
      (sessionRef.current as any)?.mute?.(next);
    } catch (err) {
      console.error("session.mute() failed or doesn't exist:", err);
    }
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
    <div className="absolute inset-0 z-50 flex flex-col overflow-y-auto bg-ink px-7 py-6 text-white">
      <div className="flex flex-shrink-0 items-start justify-between gap-4">
        {currentVisitor ? (
          <p className="text-sm text-white/60">
            Signed in as {currentVisitor.visitor_name} ({currentVisitor.visitor_type})
          </p>
        ) : (
          <span />
        )}
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
        <div className="mt-4 flex-shrink-0 overflow-hidden rounded-md" style={{ aspectRatio: "16/9", maxHeight: "220px" }}>
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

      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan/40 bg-cyan/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan voice-badge-dot" />
          AI Voice Assistant
        </span>

        <h2 className="text-center text-2xl font-semibold leading-snug sm:text-3xl">
          {muted
            ? "Microphone muted"
            : isUserSpeaking
              ? "I'm listening…"
              : status === "assistant speaking…"
                ? "Speaking…"
                : "I'm listening…"}
          <br />
          <span className="text-white/60">
            {muted ? "Tap the mic to unmute." : "You can speak now."}
          </span>
        </h2>

        <button
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          className={[
            "voice-fab-wrap",
            muted ? "voice-fab-wrap--muted" : isUserSpeaking ? "voice-fab-wrap--user" : status === "assistant speaking…" ? "voice-fab-wrap--assistant" : "",
          ].join(" ")}
          onClick={handleToggleMute}
          type="button"
        >
          <span className="voice-fab voice-fab--large">
            {!muted && (isUserSpeaking || status === "assistant speaking…") ? (
              <>
                <span className="voice-ring" style={{ animationDelay: "0s" }} />
                <span className="voice-ring" style={{ animationDelay: "0.5s" }} />
              </>
            ) : null}
            {muted ? <MicOff /> : <Mic className={isUserSpeaking ? "voice-mic-active" : ""} />}
          </span>
        </button>

        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
          {muted
            ? ""
            : isUserSpeaking
              ? "Go ahead, we can hear you"
              : status === "assistant speaking…"
                ? "Assistant speaking"
                : "Tap the mic to mute"}
        </p>
      </div>

      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-white/5 p-3 text-sm">
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

      <KioskButton className="mt-4 flex-shrink-0" onClick={handleDisconnect} variant="ghost">
        End Conversation
      </KioskButton>

      {/* Fallback attach point for the remote audio track -- see the
          NOTE in connect(). Hidden since it's only a safety net. */}
      <audio autoPlay ref={audioElementRef} style={{ display: "none" }} />
      <style jsx>{`
        @keyframes voice-room-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes voice-ring-pulse {
          0% { transform: scale(0.75); opacity: 0.65; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        .voice-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid currentColor;
          animation: voice-ring-pulse 1.3s ease-out infinite;
        }
        @keyframes voice-mic-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.18); }
        }
        .voice-mic-active {
          animation: voice-mic-pulse 0.5s ease-in-out infinite;
        }
        @keyframes voice-badge-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .voice-badge-dot {
          animation: voice-badge-pulse 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}