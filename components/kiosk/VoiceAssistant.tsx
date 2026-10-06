"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, tool, backgroundResult } from "@openai/agents/realtime";
import { z } from "zod";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import type { SkyState } from "./SkyFace";

// With barge-in enabled, the mic stays live even while the assistant is
// talking - which means its own voice bleeding back in (no headphones, or
// imperfect echo cancellation) can trigger a spurious speech_started/
// speech_stopped pair. A real utterance is essentially never this short,
// so anything shorter gets treated as noise/echo and ignored.
const MIN_REAL_SPEECH_MS = 400;

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

// Known room -> (service_type, zone_id) mapping, matching the zones table and
// kiosk_flow_services.py. TikTok has five rooms; every room except the two
// meeting rooms is booked through Spacebring (system of record) by the backend.
const ROOM_MAP: Record<string, { service_type: string; zone_id: string }> = {
  meeting_room_1: { service_type: "meeting_room", zone_id: "MR_1" },
  meeting_room_2: { service_type: "meeting_room", zone_id: "MR_2" },
  podcast_studio: { service_type: "podcast_studio", zone_id: "POD_1" },
  tiktok_studio: { service_type: "tiktok_studio", zone_id: "TTS_1" },
  tiktok_beauty_room: { service_type: "tiktok_studio", zone_id: "TTS_2" },
  tiktok_music_room: { service_type: "tiktok_studio", zone_id: "TTS_3" },
  tiktok_battle_room_1: { service_type: "tiktok_studio", zone_id: "TTS_4" },
  tiktok_battle_room_2: { service_type: "tiktok_studio", zone_id: "TTS_5" },
};

const ROOM_KEYS = Object.keys(ROOM_MAP) as [string, ...string[]];

// Next.js serves files under public/ at the root path WITHOUT a /public
// prefix (unlike the original Vite tester's paths) -- these point at
// public/images/{file} in inc-kiosk-frontend.
const ROOM_DISPLAY_INFO: Record<string, { label: string; imageUrl: string }> = {
  meeting_room_1: { label: "Meeting Room 1", imageUrl: "/images/meeting_room_1.PNG" },
  meeting_room_2: { label: "Meeting Room 2", imageUrl: "/images/meeting_room_2.PNG" },
  podcast_studio: { label: "Podcast Studio", imageUrl: "/images/podcast_studio.PNG" },
  tiktok_studio: { label: "TikTok Main Studio", imageUrl: "/images/tiktok_studio.PNG" },
  // No dedicated photos yet for the other TikTok rooms - reuse the studio photo.
  tiktok_beauty_room: { label: "TikTok Beauty Room", imageUrl: "/images/tiktok_studio.PNG" },
  tiktok_music_room: { label: "TikTok Music Room", imageUrl: "/images/tiktok_studio.PNG" },
  tiktok_battle_room_1: { label: "TikTok Battle Room 1", imageUrl: "/images/tiktok_studio.PNG" },
  tiktok_battle_room_2: { label: "TikTok Battle Room 2", imageUrl: "/images/tiktok_studio.PNG" },
};

/** Spoken-friendly reason for a failed booking-system call. */
function bookingFailureMessage(status: number, body: { message?: string } | null): string {
  if (status === 409) return "That time is already taken - offer the visitor a different time or room.";
  if (status === 502) {
    return "The booking system is temporarily unavailable. Apologise briefly and suggest asking reception.";
  }
  return body?.message || "That didn't work - tell the visitor and offer to try a different time.";
}

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
  /**
   * Called live as the visitor says each registration detail, so the
   * visible form fills in with the conversation (page.tsx already passes
   * this -- it was missing from this component's props before).
   */
  onFormFieldUpdate?: (fields: {
    full_name?: string;
    mobile_number?: string;
    email?: string;
    visitor_type?: "visitor" | "client";
  }) => void;
  /** Drives Sky in the bottom bar: off / connecting / idle / listening / speaking. */
  onSkyStateChange?: (state: SkyState) => void;
};

// Mirrors normalize_phone_() in converse.py - always normalize before
// calling the backend, in case it validates phone format strictly.
function normalizePhoneForBackend(phone: string): string {
  const raw = (phone || "").trim();
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  const cleaned = raw.replace(/[^\d]/g, "").replace(/^0+/, "");
  return `+971${cleaned}`;
}

export function VoiceAssistant({
  open,
  onClose,
  knownVisitor,
  onNeedFaceEnrollment,
  onFormFieldUpdate,
  onSkyStateChange,
}: VoiceAssistantProps) {
  const [status, setStatus] = useState("idle");
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "speaking">("idle");
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
  const onFormFieldUpdateRef = useRef(onFormFieldUpdate);
  useEffect(() => {
    onFormFieldUpdateRef.current = onFormFieldUpdate;
  }, [onFormFieldUpdate]);

  // Report Sky's state to the page so the bottom-bar head animates.
  useEffect(() => {
    const sky: SkyState = !open ? "off" : !connected ? "connecting" : voiceState;
    onSkyStateChange?.(sky);
  }, [open, connected, voiceState, onSkyStateChange]);

  // Rendered but not necessarily wired up to anything -- under WebRTC the
  // SDK is expected to handle attaching/playing the remote audio track
  // automatically. This element exists as a fallback attach point to
  // inspect/use if audio turns out to be silent after connecting; see the
  // NOTE in connect() below.
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

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
    console.log(`[voice-assistant] ${text}`);
  }

  function updateCurrentVisitor(visitor: VoiceVisitor | null) {
    currentVisitorRef.current = visitor;
    setCurrentVisitor(visitor);
  }

  function resumeAfterAssistantAudio() {
    if (conversationEndedRef.current) {
      appendToolLog("goodbye finished - disconnecting");
      setStatus("conversation ended");
      performDisconnect();
      return;
    }
    turnAwaitingUserRef.current = true;
    setStatus(mutedRef.current ? "muted - assistant done talking" : "connected - your turn to talk");
    setVoiceState(mutedRef.current ? "idle" : "listening");
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
              setVoiceState("speaking");
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
        room: z.enum(ROOM_KEYS).describe("Which room/service to show a picture of"),
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
        room: z.enum(ROOM_KEYS).describe("Which room or service to book"),
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
            message: bookingFailureMessage(res.status, body),
            details: body?.details,
          });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ booked: false, error: String(err) });
        }
      },
    });

    const checkAvailabilityTool = tool({
      name: "check_availability",
      description:
        "Check whether a room is free for a date, time and duration, BEFORE offering or booking it. " +
        "Use it whenever the visitor asks 'is it free?', and call it once you have the room, date, " +
        "time and duration, ahead of create_booking. Read-only; never books anything.",
      parameters: z.object({
        room: z.enum(ROOM_KEYS).describe("Which room or service to check"),
        date: z.string().describe("The date, in YYYY-MM-DD format"),
        time: z.string().describe("The start time, 24-hour format, e.g. '14:00'"),
        duration_minutes: z.number().describe("How long, in minutes"),
      }),
      async execute({ room, date, time, duration_minutes }: {
        room: string; date: string; time: string; duration_minutes: number;
      }) {
        const mapping = ROOM_MAP[room];
        appendToolLog(`check_availability(${room}, ${date} ${time}, ${duration_minutes}min)`);
        try {
          const query = new URLSearchParams({
            zone_id: mapping.zone_id,
            booking_date: date,
            booking_time_start: time,
            duration_minutes: String(duration_minutes),
          });
          const res = await fetch(`${BACKEND_BASE_URL}/api/kiosk/availability?${query}`);
          const body = await res.json().catch(() => ({}));
          if (res.ok && body?.data) {
            appendToolLog(`availability: ${body.data.available ? "free" : "taken"}`);
            return JSON.stringify({ available: body.data.available, room: body.data.room_name });
          }
          return JSON.stringify({ available: null, message: bookingFailureMessage(res.status, body) });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ available: null, error: String(err) });
        }
      },
    });

    const listMyBookingsTool = tool({
      name: "list_my_bookings",
      description:
        "List the signed-in visitor's current and upcoming bookings (each has a booking_id). Call this " +
        "before cancelling or rescheduling, or when they ask what they have booked.",
      parameters: z.object({}),
      async execute() {
        const visitor = currentVisitorRef.current;
        if (!visitor) {
          return JSON.stringify({ message: "No visitor is signed in yet." });
        }
        appendToolLog("list_my_bookings()");
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/api/kiosk/current-bookings?visitor_id=${visitor.visitor_id}`);
          if (res.status === 404) return JSON.stringify({ bookings: [] });
          const body = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(body?.data)) {
            appendToolLog(`${body.data.length} booking(s)`);
            return JSON.stringify({ bookings: body.data });
          }
          return JSON.stringify({ message: bookingFailureMessage(res.status, body) });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ error: String(err) });
        }
      },
    });

    const rescheduleBookingTool = tool({
      name: "reschedule_booking",
      description:
        "Move one of the signed-in visitor's existing bookings to a new date and/or start time (and " +
        "optionally a new duration). Get the booking_id from list_my_bookings, and check_availability " +
        "for the new slot first. Send only the fields that change.",
      parameters: z.object({
        booking_id: z.number().describe("The booking_id from list_my_bookings"),
        date: z.string().nullable().optional().describe("New date, YYYY-MM-DD, if it changes"),
        time: z.string().nullable().optional().describe("New start time, 24-hour, if it changes"),
        duration_minutes: z.number().nullable().optional().describe("New duration in minutes, if it changes"),
      }),
      needsApproval: true,
      async execute({ booking_id, date, time, duration_minutes }: {
        booking_id: number; date?: string | null; time?: string | null; duration_minutes?: number | null;
      }) {
        appendToolLog(`reschedule_booking(${booking_id}, ${date ?? "-"} ${time ?? "-"}, ${duration_minutes ?? "-"}min)`);
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/api/kiosk/bookings/${booking_id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(date ? { booking_date: date } : {}),
              ...(time ? { booking_time_start: time } : {}),
              ...(duration_minutes ? { duration_minutes } : {}),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (res.ok && body?.data) {
            appendToolLog(`moved: ${body.data.room_name} ${body.data.booking_date} ${body.data.booking_time_start}`);
            return JSON.stringify({ rescheduled: true, booking: body.data });
          }
          return JSON.stringify({ rescheduled: false, message: bookingFailureMessage(res.status, body) });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ rescheduled: false, error: String(err) });
        }
      },
    });

    const cancelBookingTool = tool({
      name: "cancel_booking",
      description:
        "Cancel one of the signed-in visitor's bookings. Get the booking_id from list_my_bookings and " +
        "read the booking back to the visitor before cancelling.",
      parameters: z.object({
        booking_id: z.number().describe("The booking_id from list_my_bookings"),
      }),
      needsApproval: true,
      async execute({ booking_id }: { booking_id: number }) {
        appendToolLog(`cancel_booking(${booking_id})`);
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/api/kiosk/bookings/${booking_id}`, { method: "DELETE" });
          const body = await res.json().catch(() => ({}));
          if (res.ok) {
            appendToolLog("cancelled");
            return JSON.stringify({ cancelled: true });
          }
          return JSON.stringify({ cancelled: false, message: bookingFailureMessage(res.status, body) });
        } catch (err) {
          appendToolLog(`error: ${err}`);
          return JSON.stringify({ cancelled: false, error: String(err) });
        }
      },
    });

    const captureRegistrationFieldTool = tool({
      name: "capture_registration_field",
      description:
        "Call this the moment a NEW visitor gives you any registration detail (full name, phone, " +
        "email, or whether they're a visitor or client) - even just one - so it appears on the " +
        "kiosk screen as they speak. Only include the fields they actually just gave. This does " +
        "not register them; still call register_visitor once you have all four.",
      parameters: z.object({
        full_name: z.string().nullable(),
        mobile_number: z.string().nullable(),
        email: z.string().nullable(),
        visitor_type: z.enum(["visitor", "client"]).nullable(),
      }),
      async execute(fields: {
        full_name: string | null; mobile_number: string | null; email: string | null; visitor_type: "visitor" | "client" | null;
      }) {
        const provided = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ""));
        appendToolLog(`capture_registration_field(${JSON.stringify(provided)})`);
        if (provided.mobile_number) {
          // The form shows the local part next to its own country-code picker.
          provided.mobile_number = String(provided.mobile_number).replace(/^\+971/, "").replace(/\D/g, "");
        }
        onFormFieldUpdateRef.current?.(provided);
        return backgroundResult(JSON.stringify({ shown: true }));
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

    return [
      lookupVisitorTool,
      registerVisitorTool,
      captureRegistrationFieldTool,
      createBookingTool,
      checkAvailabilityTool,
      listMyBookingsTool,
      rescheduleBookingTool,
      cancelBookingTool,
      previewRoomTool,
      endConversationTool,
    ];
  }

  // --- Instructions ---------------------------------------------------------

  function buildInstructions(knowledgeBase: string, knownVisitor: VoiceVisitor | null): string {
    const today = new Date().toISOString().slice(0, 10);

    const greetingSection = knownVisitor
      ? `**Greeting.** ${knownVisitor.visitor_name} is ALREADY signed in (${knownVisitor.visitor_type === "client" ? "existing customer" : knownVisitor.visitor_type === "employee" ? "Innovation City team member" : "new visitor"}) - do NOT ask for their name, email, phone, or customer status, you already have all of it. Just greet them warmly by name and ask how you can help.`
      : `**Greeting.** Greet the visitor warmly, briefly mention what you can help with (logging in or
registering, answering questions about Innovation City, and booking, moving or cancelling a meeting room, podcast
studio, or TikTok room), and ask ONLY whether they're an existing customer or new here - nothing
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
**Booking a room or service.** Once signed in, you can book, check, move or cancel rooms. Bookings
live in the Innovation City booking system, so always trust its answers - never guess whether a
room is free.
- Which room/service. Rooms: meeting_room_1, meeting_room_2, podcast_studio, and five TikTok rooms:
  tiktok_studio (the Main Studio), tiktok_beauty_room, tiktok_music_room, tiktok_battle_room_1,
  tiktok_battle_room_2. If they say "a meeting room" or "a TikTok room" without saying which, ask
  which. Podcast: only one, don't ask.
- Date, time, and duration in minutes.

The moment the room/service choice is settled - even before you've collected date, time, or
duration - call preview_room with it so the visitor sees a picture of it.

Gather whatever's missing across turns - don't demand everything at once. Once you have room, date,
time and duration, call check_availability. If it's free, call create_booking. If it's taken, say
so in one short sentence and offer another time or room (check that too before offering it).

To see what they have booked, call list_my_bookings. To move a booking, call list_my_bookings, agree
the new time, call check_availability for it, then reschedule_booking. To cancel, call
list_my_bookings, read the booking back, then cancel_booking. Moving and cancelling ask the visitor
to confirm on screen, so don't promise it's done until the tool says so.

If a booking tool says the booking system is unavailable, apologise briefly and suggest reception.
Must be signed in first.

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
          appendToolLog(`response.created (id=${responseId}), turnAwaitingUser=${turnAwaitingUserRef.current}`);
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
          setVoiceState("speaking");
        } else if (event?.type === "response.done") {
          // A response that called a tool (e.g. lookup_visitor) ends with
          // response.done the MOMENT the function call is emitted -- the
          // model hasn't actually spoken its reply yet, that comes in a
          // SECOND, separate response once the tool result is back. If we
          // treated this first response.done as "the whole turn is over"
          // (the old behavior), turnAwaitingUserRef got reset to true, and
          // the real reply's response.created right after got wrongly
          // cancelled as "unrequested" -- the tool found the name, but the
          // "Welcome back" reply never got heard. Only resume the
          // visitor's turn when this response was NOT just a tool-call
          // dispatch -- i.e., it actually contained real spoken output.
          const outputItems = event?.response?.output ?? [];
          const itemTypes = outputItems.map((item: any) => item?.type).join(", ") || "(empty)";
          const transcripts = outputItems
            .flatMap((item: any) => item?.content ?? [])
            .map((c: any) => c?.transcript || c?.text)
            .filter(Boolean)
            .join(" | ");
          appendToolLog(`response.done (id=${event?.response?.id}), status=${event?.response?.status}, output types=[${itemTypes}], transcript="${transcripts || "(none)"}"`);
          const wasToolCallOnly =
            outputItems.length > 0 && outputItems.every((item: any) => item?.type === "function_call");
          if (wasToolCallOnly) {
            appendToolLog("-> treated as tool-call dispatch, waiting for follow-up response");
          } else {
            resumeAfterAssistantAudio();
          }
        } else if (event?.type === "input_audio_buffer.speech_started") {
          speechStartedAt = performance.now();
          speechStartedAtRef.current = speechStartedAt;
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
    setMuted(next);
    setStatus(next ? "muted" : "connected - just start talking");
    setVoiceState(next ? "idle" : "listening");
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

  // Last thing either side said, shown as a one-line caption so the
  // visitor can see they were heard. Tool-log lines stay in the console.
  const lastLine = [...transcript].reverse().find((line) => line.kind !== "tool");

  return (
    <div className="voice-dock" role="status" aria-live="polite">
      {roomPreview ? (
        <figure className="voice-room">
          <img key={roomPreview.imageUrl} alt={roomPreview.label} src={roomPreview.imageUrl} />
          <figcaption>{roomPreview.label}</figcaption>
        </figure>
      ) : null}
      <div className="voice-bubble">
        <div className="voice-bubble-text">
          <span className="voice-status">
            {currentVisitor ? `${currentVisitor.visitor_name} · ` : ""}
            {status}
          </span>
          {lastLine ? (
            <p className={lastLine.kind === "user" ? "voice-line user" : "voice-line"}>{lastLine.text}</p>
          ) : null}
        </div>
        <div className="voice-bubble-actions">
          <button className="voice-action" onClick={handleToggleMute} type="button" aria-pressed={muted}>
            {muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
            <span>{muted ? "Unmute" : "Mute"}</span>
          </button>
          <button className="voice-action end" onClick={handleDisconnect} type="button">
            <PhoneOff aria-hidden />
            <span>End</span>
          </button>
        </div>
      </div>
      {/* Fallback attach point for the remote audio track -- see the
          NOTE in connect(). Hidden since it's only a safety net. */}
      <audio autoPlay ref={audioElementRef} style={{ display: "none" }} />
    </div>
  );
}