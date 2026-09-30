"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  KeyRound,
  Mic,
  Phone,
  Sparkles,
  User,
} from "lucide-react";
import { ApiRequestError, requestJson } from "@/lib/api";
import { VoiceAssistant } from "@/components/kiosk/VoiceAssistant";
import { SkyFace, type SkyState } from "@/components/kiosk/SkyFace";
import { KioskSelect, type KioskOption } from "@/components/kiosk/KioskSelect";
import { DatePicker, TimePicker } from "@/components/kiosk/DateTimePickers";
import { PhotoImg, preloadRoomPhotos, roomDescription, ROOM_FACTS, ROOM_PHOTOS, RoomChoiceCard, RoomPhoto } from "@/components/kiosk/RoomPhoto";
import { BrandHero, EyebrowMark, HeaderBrand, LogoCountdown, PanelBrand } from "@/components/kiosk/Brand";
import { Typewriter } from "@/components/kiosk/Typewriter";
import { VisitorPass, type VisitorPassDetails } from "@/components/kiosk/VisitorPass";
import { usePresence } from "@/components/kiosk/usePresence";
import { navigateBack, withViewTransition } from "@/components/kiosk/viewTransition";
import { FaceScanOverlay, type KycMode, type KycPhase } from "@/components/kiosk/FaceScanOverlay";
import {
  CalendarIcon,
  CreateProfileIcon,
  EventsIcon,
  ExploreIcon,
  MeetingRoomIcon,
  FindPlaceIcon,
  HomeIcon,
  IncognitoIcon,
  PlanVisitIcon,
  PodcastIcon,
  ReportIcon,
  ScanFaceIcon,
  SupportIcon,
  TikTokIcon,
} from "@/components/kiosk/KioskIcons";
import {
  isBookableService,
  type KioskStep,
  type ServiceType,
} from "@/lib/flow";
import {
  LATEST_BOOKING_START,
  OPERATING_HOURS_MESSAGE,
  OPERATING_HOURS_START,
  bookingDurationOptions,
  isPastDateTime,
  toDateInputValue,
} from "@/lib/time";
import { centerRoomOptions } from "@/lib/kiosk-content";

type Visitor = {
  visitor_id: number;
  visitor_name: string;
  visitor_phone: string;
  visitor_email?: string | null;
  visitor_type: "client" | "visitor";
  company_name?: string | null;
  company_number?: string | null;
  face_consent_given: boolean;
};

type VisitSession = {
  visit_session_id: number;
  is_returning_visitor: boolean;
};

type FaceCheckSuggestion = {
  rank: number;
  /** Optional display name, if the backend can resolve one for this match. */
  name?: string | null;
  source_url: string;
  score?: number | null;
  thumbnail_base64?: string | null;
};

type RecognitionResult = {
  recognized: boolean;
  visitor_id?: number | null;
  matched_name?: string | null;
  confidence?: number | null;
  capture_id?: number | null;
  facecheck_suggestions?: FaceCheckSuggestion[] | null;
};

type LinkCaptureResult = {
  capture_id: number;
  visitor_id: number;
  face_identifier?: string | null;
  enrolled: boolean;
};

type FaceProfileResult = {
  face_profile_id: number;
  visitor_id: number;
  face_identifier: string;
  sample_count: number;
};

type CurrentBooking = {
  booking_id: number;
  booking_name: string;
  booking_time_start: string;
  booking_time_end: string;
  room_name: string;
};

type ConfirmationState = {
  title: string;
  message: string;
  /** Shown as the branded visitor pass. */
  pass: VisitorPassDetails;
};

// "2026-09-28" -> "Mon 28 Sep 2026" (no timezone shift: it's a calendar date)
function formatPassDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} hr${hours === 1 ? "" : "s"}`;
}

type KioskEvent = {
  event_id: number;
  event_name: string;
  event_time_start: string;
  event_time_end: string;
  event_location: string;
  short_description: string;
};

type BookingForm = {
  zoneId: string;
  date: string;
  time: string;
  duration: string;
};

// "identify" = the "How would you like to continue?" screen (Figma node
// 665-2650), shown after the start screen whether or not the face search
// returned suggestions. Kept local so lib/flow.ts doesn't need to change.
type Step = KioskStep | "identify" | "report-issue" | "room-select";

const todayIso = () => toDateInputValue();

// After a visit is finished (booking/event confirmed, support request sent,
// or "Finish" on welcome-back), the kiosk counts down this many seconds and
// then returns to the check-in screen for the next visitor.
const AUTO_RETURN_SECONDS = 5;
// The visitor pass (booking / event confirmed) stays longer so there's
// time to read it before the kiosk returns to the start.
const PASS_RETURN_SECONDS = 10;

// "Scan my face again" scanner timing: time to settle the face in the
// oval, then the ring fill while scanning (the photo is taken at its end),
// then how long the result stays on screen before moving on.
const KYC_ALIGN_MS = 1400;
const KYC_SCAN_MS = 1800;
const KYC_RESULT_MS = 1200;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// Start screen: "idle" until someone is detected close to the kiosk
// (usePresence), then the same screen types over into the check-in text
// and the face scan starts.
const START_TEXT = {
  idle: {
    eyebrow: "Welcome",
    title: "Welcome to\nInnovation City",
    copy: "Step closer to the screen\nto check in.",
  },
  engaged: {
    eyebrow: "Check in",
    title: "Let\u2019s get you\nchecked in",
    copy: "We may already have your profile.\nLet\u2019s take a quick look.",
  },
} as const;

const FACE_LOGIN_SAMPLE_COUNT = 1;
const FACE_LOGIN_RETRY_SAMPLE_COUNT = 2;
const FACE_ENROLLMENT_SAMPLE_COUNT = 3;
const FACE_CAPTURE_WIDTH = 360;
const FACE_CAPTURE_HEIGHT = 270;
const FACE_CAPTURE_QUALITY = 0.76;

const initialBookingForm: BookingForm = {
  zoneId: "MR_1",
  date: todayIso(),
  time: "",
  duration: "",
};

// Order + copy matches the Figma "What brings you to Innovation City
// today?" grid (INC-live-dashboard, node 665-2912): Meeting, Events,
// Booking, Tik Tok Studio, Podcast Studio, Support. Each card keeps its
// existing `id` (and therefore its existing step/handler wiring) --
// only the label, description, order, and icon changed to match.
const serviceCards: Array<{
  id: ServiceType;
  title: string;
  description: string;
  icon: () => React.ReactElement;
}> = [
  {
    id: "business_center",
    title: "Explore",
    description: "Discover the center's spaces.",
    icon: ExploreIcon,
  },
  {
    id: "event",
    title: "Events",
    description: "Join an event or workshop.",
    icon: EventsIcon,
  },
  {
    id: "meeting_room",
    title: "Meeting Rooms",
    description: "Book or find a meeting room.",
    icon: MeetingRoomIcon,
  },
  {
    id: "tiktok_studio",
    title: "Tik Tok Studio",
    description: "Everything for TikTok Content",
    icon: TikTokIcon,
  },
  {
    id: "podcast_studio",
    title: "Podcast Studio",
    description: "Record, edit and stream with ease.",
    icon: PodcastIcon,
  },
  {
    id: "other",
    title: "Support",
    description: "Get help with something else.",
    icon: SupportIcon,
  },
];

type IdentifyOption = "visitor" | "new-profile" | "rescan" | "report";

const identifyOptions: Array<{ id: IdentifyOption; label: string; icon: () => React.ReactElement }> = [
  { id: "visitor", label: "Continue as a visitor", icon: IncognitoIcon },
  { id: "new-profile", label: "Create new profile", icon: CreateProfileIcon },
  { id: "rescan", label: "Scan my face again", icon: ScanFaceIcon },
  { id: "report", label: "Report recognition issue", icon: ReportIcon },
];

const countryCodeOptions = [
  ["+971", "UAE"],
  ["+966", "KSA"],
  ["+974", "Qatar"],
  ["+965", "Kuwait"],
  ["+973", "Bahrain"],
  ["+968", "Oman"],
  ["+1", "US"],
  ["+44", "UK"],
] as const;

function normalizeLocalMobileNumber(value: string): string {
  return value.replace(/^\+971/, "").replace(/^00971/, "").replace(/^0+/, "").replace(/\D/g, "");
}

export default function KioskPage() {
  const [step, setStepNow] = useState<Step>("start");
  const stepRef = useRef<Step>("start");
  stepRef.current = step;
  // Every screen change goes through here, so each one animates (screen
  // content slides, the logo morphs between welcome and header). See
  // components/kiosk/viewTransition.ts.
  const setStep = useCallback((next: SetStateAction<Step>) => {
    if (typeof next !== "function" && next === stepRef.current) return;
    withViewTransition(() => setStepNow(next));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<number | null>(null);
  const [facecheckSuggestions, setFacecheckSuggestions] = useState<FaceCheckSuggestion[] | null>(null);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "recognized" | "unknown">("idle");
  const autoScanTriggeredRef = useRef(false);
  const [presence, setPresence] = useState<"idle" | "engaged">("idle");
  // Becomes true once the check-in title has finished typing -- the face
  // scan starts then, so the visitor has had a moment to face the camera.
  const [greetingReady, setGreetingReady] = useState(false);
  const [kycPhase, setKycPhase] = useState<KycPhase | null>(null);
  const [issueText, setIssueText] = useState("");
  // Guest pressed Reserve slot / Register for event: registration sheet
  // opens over the same screen, then that action finishes automatically.
  const [quickRegister, setQuickRegister] = useState<null | { action: "booking" | "event"; tab: "new" | "existing" }>(null);
  // Which thank-you to show: the normal end of a visit, or after a report.
  const [thankYouKind, setThankYouKind] = useState<"visit" | "report">("visit");
  const kycCancelledRef = useRef(false);
  const [kycMode, setKycMode] = useState<KycMode>("check-in");
  // The scanner's camera stream, kept so "Scan again" can reuse it.
  const kycStreamRef = useRef<MediaStream | null>(null);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [visitSession, setVisitSession] = useState<VisitSession | null>(null);
  const [currentBookings, setCurrentBookings] = useState<CurrentBooking[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceType>("meeting_room");
  const [consentChecked, setConsentChecked] = useState(true);
  const [events, setEvents] = useState<KioskEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<KioskEvent | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [bookingForm, setBookingForm] = useState<BookingForm>(initialBookingForm);
  const [otherReason, setOtherReason] = useState("start_company");
  const [otherNotes, setOtherNotes] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [skyState, setSkyState] = useState<SkyState>("off");
  const [enrollmentProgress, setEnrollmentProgress] = useState(0);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const enrollmentVisitorRef = useRef<Visitor | null>(null);
  const [lookup, setLookup] = useState({
    full_name: "",
    country_code: "+971",
    mobile_number: "",
  });
  const [registration, setRegistration] = useState({
    full_name: "",
    country_code: "+971",
    mobile_number: "",
    email: "",
    visitor_type: "visitor" as "client" | "visitor",
  });

  useEffect(() => {
    if (step !== "start") {
      // Leaving the start screen (visit finished / reset) re-arms the
      // trigger so the *next* visitor's page-open fires a fresh scan.
      autoScanTriggeredRef.current = false;
      return;
    }
    if (autoScanTriggeredRef.current || presence !== "engaged" || !greetingReady) {
      return;
    }
    // Give the page a beat to settle (camera preview above is also
    // requesting getUserMedia) before firing the automatic scan.
    // Note: the ref is only marked "consumed" inside the timeout callback,
    // not before scheduling it -- this matters because Next.js dev mode
    // double-invokes effects on mount (cleanup then re-run), which would
    // otherwise cancel this timer on the first pass and skip re-arming it
    // on the second, silently swallowing the auto-trigger.
    const timer = window.setTimeout(() => {
      autoScanTriggeredRef.current = true;
      handleFaceScan();
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, presence, greetingReady]);

  usePresence(step === "start" && presence === "idle", () => setPresence("engaged"));

  const firstName = useMemo(() => {
    return visitor?.visitor_name?.split(" ")[0] || "John";
  }, [visitor]);

  function resetFlow() {
    setStep("start");
    setBusy(false);
    setError(null);
    setVisitor(null);
    setVisitSession(null);
    setCurrentBookings([]);
    setCaptureId(null);
    setFacecheckSuggestions(null);
    setScanState("idle");
    setPresence("idle");
    setGreetingReady(false);
    setIssueText("");
    setThankYouKind("visit");
    setQuickRegister(null);
    setSelectedEvent(null);
    setConfirmation(null);
    setBookingForm({ ...initialBookingForm, date: todayIso() });
    setEnrollmentProgress(0);
    setEnrollmentError(null);
    enrollmentVisitorRef.current = null;
    setLookup({ full_name: "", country_code: "+971", mobile_number: "" });
    setRegistration({
      full_name: "",
      country_code: "+971",
      mobile_number: "",
      email: "",
      visitor_type: "visitor",
    });
    setOtherNotes("");
  }

  async function createSession(nextVisitor: Visitor, recognitionMethod: "face" | "lookup" | "manual") {
    const session = await requestJson<VisitSession>("/api/kiosk/visit-sessions", {
      method: "POST",
      body: JSON.stringify({
        visitor_id: nextVisitor.visitor_id,
        recognition_method: recognitionMethod,
      }),
    });
    setVisitSession(session);
    return session;
  }

  async function loadCurrentBookings(nextVisitor: Visitor) {
    try {
      const bookings = await requestJson<CurrentBooking[]>(
        `/api/kiosk/current-bookings?visitor_id=${nextVisitor.visitor_id}`,
      );
      setCurrentBookings(bookings);
    } catch (bookingError) {
      if (
        bookingError instanceof ApiRequestError &&
        bookingError.errorCode === "BOOKING_NOT_FOUND"
      ) {
        setCurrentBookings([]);
        return;
      }
      throw bookingError;
    }
  }

  function handleRegisterLink() {
    setRegistration((value) => ({
      ...value,
      full_name: lookup.full_name,
      mobile_number: normalizeLocalMobileNumber(lookup.mobile_number),
    }));
    setError(null);
    setStep("register");
  }

  async function handleFaceScan(
    scanner: {
      stream?: MediaStream;
      onChecking?: () => void;
      /** Shows the result on the scanner before the page moves on. */
      onResult?: (result: "found" | "not-found" | "error") => Promise<void>;
    } = {},
  ) {
    setBusy(true);
    setError(null);
    setScanState("scanning");
    try {
      const images = await captureFaceSamples(FACE_ENROLLMENT_SAMPLE_COUNT, {
        updateEnrollmentProgress: false,
        stream: scanner.stream,
      });
      scanner.onChecking?.();
      const result = await requestJson<RecognitionResult>("/api/kiosk/recognize-face", {
        method: "POST",
        body: JSON.stringify({ images_base64: images }),
      });

      if (result.recognized && result.visitor_id) {
        setScanState("recognized");
        await scanner.onResult?.("found");
        const foundVisitor = await requestJson<Visitor>(`/api/kiosk/visitors/${result.visitor_id}`);
        setVisitor(foundVisitor);
        await createSession(foundVisitor, "face");
        await loadCurrentBookings(foundVisitor);
        setStep("welcome-back");
        setVoiceOpen(true);
        return;
      }

      if (result.capture_id) {
        setCaptureId(result.capture_id);
      }

      // Not recognized: always move on to the "How would you like to
      // continue?" screen. With FaceCheckID suggestions it shows up to 3
      // match cards; without any it shows only the 4 options.
      const suggestions = result.facecheck_suggestions ?? [];
      await scanner.onResult?.("not-found");
      setScanState(suggestions.length > 0 ? "unknown" : "idle");
      setFacecheckSuggestions(suggestions.length > 0 ? suggestions.slice(0, 3) : null);
      setStep("identify");
    } catch (scanError) {
      await scanner.onResult?.("error");
      setError(scanError instanceof Error ? scanError.message : "Face scan failed.");
      setScanState("idle");
      setFacecheckSuggestions(null);
      setStep("identify");
    } finally {
      setBusy(false);
    }
  }

  function handleFaceCheckRespond() {
    // Whether the visitor picked one of the FaceCheckID suggestions or said
    // "none of these", the next step is the same: collect their details and
    // link that capture to a (new or found) visitor. The chosen suggestion
    // itself doesn't need to travel with them -- it's already stored in
    // face_web_matches against this capture_id for admin review later.
    setFacecheckSuggestions(null);
    setScanState("idle");
    setError(null);
    setRegistration((value) => ({ ...value }));
    setStep("register");
  }

  function handleIdentifyOption(option: IdentifyOption) {
    setError(null);
    if (option === "visitor") {
      // Guest path: no profile, straight to the services grid. Bookings
      // still ask them to create/verify a profile first (handleBooking).
      // Suggestions are kept so Home shows the same match cards again.
      setStep("service-selection");
      return;
    }
    if (option === "new-profile") {
      // Same as picking a suggestion: keeps captureId, so registration
      // links + enrolls the face that was just scanned.
      handleFaceCheckRespond();
      return;
    }
    if (option === "rescan") {
      kycCancelledRef.current = false;
      setKycMode("check-in");
      setKycPhase("starting"); // the overlay opens the camera, then runKycScan()
      return;
    }
    // "Report recognition issue": a simple message box, no registration.
    setIssueText("");
    setStep("report-issue");
  }

  // Runs once the scanner overlay has the camera: settle, scan, check,
  // show the result, then continue exactly like the automatic scan.
  async function runKycScan(stream: MediaStream) {
    setKycPhase("align");
    await wait(KYC_ALIGN_MS);
    if (kycCancelledRef.current) return;
    setKycPhase("scanning");
    await wait(KYC_SCAN_MS);
    if (kycCancelledRef.current) return;
    await handleFaceScan({
      stream,
      onChecking: () => setKycPhase("checking"),
      onResult: async (result) => {
        setKycPhase(result);
        await wait(KYC_RESULT_MS);
      },
    });
    setKycPhase(null);
  }

  // New visitor: settle, scan (the photos are taken in the last part of the
  // scan), save the face profile, show "Face saved", then go to services.
  // On failure the scanner stays open with "Scan again" / "Continue without".
  async function runKycEnroll(stream: MediaStream) {
    const nextVisitor = enrollmentVisitorRef.current || visitor;
    if (!nextVisitor) return;
    setEnrollmentError(null);
    setKycPhase("align");
    await wait(KYC_ALIGN_MS);
    if (kycCancelledRef.current) return;
    setKycPhase("scanning");
    await wait(Math.max(0, KYC_SCAN_MS - 700)); // 3 photos take ~0.7s
    if (kycCancelledRef.current) return;
    setBusy(true);
    try {
      const images = await captureFaceSamples(FACE_ENROLLMENT_SAMPLE_COUNT, { updateEnrollmentProgress: false, stream });
      if (kycCancelledRef.current) return;
      setKycPhase("checking");
      await requestJson<FaceProfileResult>("/api/kiosk/face-profile", {
        method: "POST",
        body: JSON.stringify({ visitor_id: nextVisitor.visitor_id, images_base64: images }),
      });
      await createSession(nextVisitor, "manual");
      setKycPhase("found");
      await wait(KYC_RESULT_MS);
      setKycPhase(null);
      setStep("service-selection");
    } catch (enrollError) {
      console.warn("Face enrollment failed:", enrollError);
      setEnrollmentError(enrollError instanceof Error ? enrollError.message : "Could not enroll your face.");
      setKycPhase("error");
    } finally {
      setBusy(false);
    }
  }

  function handleKycStream(stream: MediaStream) {
    kycStreamRef.current = stream;
    if (kycMode === "enroll") runKycEnroll(stream);
    else runKycScan(stream);
  }

  function cancelKycScan() {
    kycCancelledRef.current = true;
    setKycPhase(null);
    // Backing out of registration returns to the face-consent choice.
    if (kycMode === "enroll") setStep("facial-consent");
  }

  function goHome() {
    // Figma's "Click on Home" goes back to the "How would you like to
    // continue?" screen, not the check-in screen. The visit (visitor,
    // session, match suggestions) is kept; "Back to start" on the
    // thank-you screen is still the full reset.
    setError(null);
    setConfirmation(null);
    setSelectedEvent(null);
    navigateBack();
    setStep("identify");
  }

  // Full reset for the next visitor: also hangs up any voice session so the
  // next person doesn't inherit this visitor's conversation.
  //
  // The countdown's logo circle and the welcome screen's big logo share a
  // view-transition name, so the browser flies the circle up and grows it
  // into the welcome logo while the rest crossfades (globals.css). Browsers
  // without View Transitions just switch screens.
  function finishVisit() {
    withViewTransition(() => {
      setVoiceOpen(false);
      resetFlow();
    }, "reset");
  }

  function handleSkyPress() {
    // Sky is the only voice entry point now: tap to start, tap again to stop.
    setVoiceOpen((open) => !open);
  }

  async function handleProfileLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const foundVisitor = await requestJson<Visitor>("/api/kiosk/profile-lookup", {
        method: "POST",
        body: JSON.stringify({
          full_name: lookup.full_name,
          mobile_number: `${lookup.country_code}${normalizeLocalMobileNumber(lookup.mobile_number)}`,
        }),
      });
      setVisitor(foundVisitor);
      await createSession(foundVisitor, "lookup");
      await loadCurrentBookings(foundVisitor);
      setStep("welcome-back");
      setVoiceOpen(true);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Profile not found.");
    } finally {
      setBusy(false);
    }
  }

  // Creates the visitor from the `registration` form. If this visit started
  // with a face scan, links that scan to the new profile (and enrolls it).
  async function createVisitorFromForm(): Promise<{ visitor: Visitor; linkedFace: boolean }> {
    const mobileNumber = `${registration.country_code}${normalizeLocalMobileNumber(registration.mobile_number)}`;
    if (captureId) {
      const linkResult = await requestJson<LinkCaptureResult>(`/api/face/captures/${captureId}/link`, {
        method: "POST",
        body: JSON.stringify({
          full_name: registration.full_name,
          mobile_number: mobileNumber,
          email: registration.email,
          visitor_type: registration.visitor_type,
          enroll_face: true,
        }),
      });
      const linkedVisitor = await requestJson<Visitor>(`/api/kiosk/visitors/${linkResult.visitor_id}`);
      setCaptureId(null);
      return { visitor: linkedVisitor, linkedFace: true };
    }
    const createdVisitor = await requestJson<Visitor>("/api/kiosk/profiles", {
      method: "POST",
      body: JSON.stringify({
        full_name: registration.full_name,
        mobile_number: mobileNumber,
        email: registration.email,
        visitor_type: registration.visitor_type,
        company_name: null,
        company_number: null,
      }),
    });
    return { visitor: createdVisitor, linkedFace: false };
  }

  // Registration sheet submit: sign the guest in (new profile or lookup),
  // start their session, then finish the booking / event they asked for.
  async function handleQuickRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickRegister) return;
    setBusy(true);
    setError(null);
    try {
      let nextVisitor: Visitor;
      let method: "face" | "lookup" | "manual";
      if (quickRegister.tab === "existing") {
        nextVisitor = await requestJson<Visitor>("/api/kiosk/profile-lookup", {
          method: "POST",
          body: JSON.stringify({
            full_name: lookup.full_name,
            mobile_number: `${lookup.country_code}${normalizeLocalMobileNumber(lookup.mobile_number)}`,
          }),
        });
        method = "lookup";
      } else {
        const created = await createVisitorFromForm();
        nextVisitor = created.visitor;
        method = created.linkedFace ? "face" : "manual";
      }
      setVisitor(nextVisitor);
      const session = await createSession(nextVisitor, method);
      const action = quickRegister.action;
      setQuickRegister(null);
      setBusy(false);
      if (action === "booking") await submitBooking(nextVisitor, session.visit_session_id);
      else await submitEventRegistration(nextVisitor, session.visit_session_id);
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : quickRegister.tab === "existing"
            ? "Profile not found."
            : "Could not create profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const mobileNumber = `${registration.country_code}${normalizeLocalMobileNumber(registration.mobile_number)}`;

      if (captureId) {
        // Came from the FaceCheckID "is this you?" prompt: the face we just
        // scanned is already saved against this capture, so linking it also
        // enrolls it as this visitor's face profile in one step -- no need
        // for a second face-scan/consent step.
        const linkResult = await requestJson<LinkCaptureResult>(
          `/api/face/captures/${captureId}/link`,
          {
            method: "POST",
            body: JSON.stringify({
              full_name: registration.full_name,
              mobile_number: mobileNumber,
              email: registration.email,
              visitor_type: registration.visitor_type,
              enroll_face: true,
            }),
          },
        );
        const linkedVisitor = await requestJson<Visitor>(`/api/kiosk/visitors/${linkResult.visitor_id}`);
        setVisitor(linkedVisitor);
        setCaptureId(null);
        await createSession(linkedVisitor, "face");
        await loadCurrentBookings(linkedVisitor);
        setStep("welcome-back");
        setVoiceOpen(true);
        return;
      }

      const createdVisitor = await requestJson<Visitor>("/api/kiosk/profiles", {
        method: "POST",
        body: JSON.stringify({
          full_name: registration.full_name,
          mobile_number: mobileNumber,
          email: registration.email,
          visitor_type: registration.visitor_type,
          company_name: null,
          company_number: null,
        }),
      });
      setVisitor(createdVisitor);
      setStep("facial-consent");
    } catch (registrationError) {
      setError(registrationError instanceof Error ? registrationError.message : "Could not create profile.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConsent(enableFaceScan: boolean) {
    if (!visitor) return;

    setBusy(true);
    setError(null);
    try {
      const updatedVisitor = await requestJson<Visitor>("/api/kiosk/facial-consent", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          consent_given: enableFaceScan,
        }),
      });
      setVisitor(updatedVisitor);

      if (enableFaceScan) {
        enrollmentVisitorRef.current = updatedVisitor;
        setEnrollmentProgress(0);
        setEnrollmentError(null);
        setStep("scan-progress");
        // Same full-screen scanner as "Scan my face again", in enroll mode;
        // it opens the camera and then calls runKycEnroll().
        kycCancelledRef.current = false;
        setKycMode("enroll");
        setKycPhase("starting");
      } else {
        await createSession(updatedVisitor, "manual");
        setStep("service-selection");
      }
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : "Could not save consent.");
    } finally {
      setBusy(false);
    }
  }

  async function captureFaceSamples(
    sampleCount = FACE_ENROLLMENT_SAMPLE_COUNT,
    options: { updateEnrollmentProgress?: boolean; stream?: MediaStream } = {},
  ): Promise<string[]> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not available in this browser.");
    }

    // The face-scan overlay passes in the stream it is already showing, so
    // the photo comes from the same camera feed the visitor sees. That
    // stream belongs to the overlay, so it isn't stopped here.
    const ownsStream = !options.stream;
    const stream =
      options.stream ??
      (await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: FACE_CAPTURE_WIDTH },
          height: { ideal: FACE_CAPTURE_HEIGHT },
        },
        audio: false,
      }));
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    try {
      await video.play();
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.onloadedmetadata = () => resolve();
      });

      const canvas = document.createElement("canvas");
      canvas.width = FACE_CAPTURE_WIDTH;
      canvas.height = FACE_CAPTURE_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare face capture.");

      const samples: string[] = [];
      for (let index = 0; index < sampleCount; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, index === 0 ? 180 : 260));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        samples.push(canvas.toDataURL("image/jpeg", FACE_CAPTURE_QUALITY));
        if (options.updateEnrollmentProgress !== false) {
          setEnrollmentProgress(index + 1);
        }
      }
      return samples;
    } finally {
      if (ownsStream) stream.getTracks().forEach((track) => track.stop());
    }
  }

  // Unlike the on-screen registration scan (runKycEnroll): just captures + saves a face
  // photo, without navigating the page or creating a session -- called
  // from inside the voice assistant's register_visitor tool, where the
  // visitor could be on any screen and the voice conversation should just
  // continue afterward, not redirect them anywhere.
  async function handleVoiceFaceEnrollment(voiceVisitor: { visitor_id: number; visitor_name: string; visitor_type: string }) {
    const images = await captureFaceSamples(FACE_ENROLLMENT_SAMPLE_COUNT);
    await requestJson<FaceProfileResult>("/api/kiosk/face-profile", {
      method: "POST",
      body: JSON.stringify({
        visitor_id: voiceVisitor.visitor_id,
        images_base64: images,
      }),
    });
    // Reflect the newly registered + enrolled visitor in the page's own
    // state too, so the underlying kiosk screen (and any later reconnect
    // to voice assistance) already knows who they are.
    const fullVisitor = await requestJson<Visitor>(`/api/kiosk/visitors/${voiceVisitor.visitor_id}`);
    setVisitor(fullVisitor);
  }

  // Called live from the voice assistant's capture_registration_field tool
  // as soon as the visitor gives ANY single piece of info -- populates the
  // visible registration form fields in sync with the conversation. Only
  // updates fields actually provided (spread over previous state), and
  // navigates to the "register" screen if the visitor isn't already
  // somewhere the fields would be visible, so this is never silently
  // updating state behind an unrelated screen.
  function handleVoiceFormFieldUpdate(fields: {
    full_name?: string;
    mobile_number?: string;
    email?: string;
    visitor_type?: "visitor" | "client";
  }) {
    setRegistration((prev) => ({
      ...prev,
      ...(fields.full_name !== undefined ? { full_name: fields.full_name } : {}),
      ...(fields.mobile_number !== undefined ? { mobile_number: fields.mobile_number } : {}),
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.visitor_type !== undefined ? { visitor_type: fields.visitor_type } : {}),
    }));
    setStep((currentStep) => (currentStep === "register" ? currentStep : "register"));
  }

  async function skipFaceEnrollment() {
    const nextVisitor = enrollmentVisitorRef.current || visitor;
    if (!nextVisitor) return;
    setBusy(true);
    setEnrollmentError(null);
    try {
      await createSession(nextVisitor, "manual");
      setStep("service-selection");
    } catch (sessionError) {
      setEnrollmentError(sessionError instanceof Error ? sessionError.message : "Could not continue.");
    } finally {
      setBusy(false);
    }
  }

  async function handleServiceSelect(service: ServiceType) {
    setSelectedService(service);
    setError(null);

    if (isBookableService(service)) {
      setBookingForm((value) => ({
        ...value,
        zoneId:
          service === "meeting_room"
            ? value.zoneId || "MR_1"
            : service === "podcast_studio"
              ? "POD_1"
              : "TTS_1",
      }));
      if (service === "meeting_room") setStep("room-select"); // pick the room by photo first
      if (service === "podcast_studio") setStep("booking-podcast");
      if (service === "tiktok_studio") setStep("booking-tiktok");
      return;
    }

    if (service === "event") {
      setBusy(true);
      try {
        setEvents(await requestJson<KioskEvent[]>("/api/kiosk/events/today"));
        setStep("events");
      } catch (eventsError) {
        setError(eventsError instanceof Error ? eventsError.message : "Could not load events.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (service === "business_center") {
      setStep("center");
      return;
    }

    setStep("other");
  }

  async function handleBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingForm.date || !bookingForm.time || !bookingForm.duration) {
      setError("Choose a date, time and duration first.");
      return;
    }

    if (isPastDateTime(bookingForm.date, bookingForm.time)) {
      setError("Please choose a date and time that has not already passed.");
      return;
    }

    if (!bookingDurationOptions(bookingForm.time).some((option) => option.value === bookingForm.duration)) {
      setError(OPERATING_HOURS_MESSAGE);
      return;
    }

    if (!visitor) {
      // Not registered / recognised: register right here, then book.
      setError(null);
      setQuickRegister({ action: "booking", tab: "new" });
      return;
    }
    await submitBooking(visitor, visitSession?.visit_session_id);
  }

  async function submitBooking(activeVisitor: Visitor, visitSessionId?: number) {
    setBusy(true);
    setError(null);
    try {
      const createdBooking = await requestJson<CurrentBooking>("/api/kiosk/bookings", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: activeVisitor.visitor_id,
          visit_session_id: visitSessionId,
          service_type: selectedService,
          zone_id: bookingForm.zoneId,
          booking_date: bookingForm.date,
          booking_time_start: bookingForm.time,
          duration_minutes: Number.parseInt(bookingForm.duration, 10),
        }),
      });
      showConfirmation({
        title: "Booking Confirmed",
        message: `${createdBooking.room_name} is reserved from ${formatTime(createdBooking.booking_time_start)} to ${formatTime(createdBooking.booking_time_end)}.`,
        pass: {
          status: "Booking confirmed",
          name: activeVisitor.visitor_name,
          placeLabel: "Room",
          place: createdBooking.room_name,
          date: formatPassDate(bookingForm.date),
          time: `${formatSlot(formatTime(createdBooking.booking_time_start))} – ${formatSlot(formatTime(createdBooking.booking_time_end))}`,
          timeDetail: formatDuration(Number.parseInt(bookingForm.duration, 10)),
          note: "Tap Find a place any time for directions to your room.",
          photo:
            selectedService === "meeting_room"
              ? ROOM_PHOTOS[bookingForm.zoneId] ?? ROOM_PHOTOS.MR_1
              : selectedService === "podcast_studio"
                ? ROOM_PHOTOS.podcast_studio
                : ROOM_PHOTOS.tiktok_studio,
        },
      });
    } catch (bookingError) {
      if (bookingError instanceof ApiRequestError && bookingError.errorCode === "BOOKING_OVERLAP") {
        setError("That time is already booked. Please choose another time.");
      } else {
        setError(bookingError instanceof Error ? bookingError.message : "Could not submit booking.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEventRegistration() {
    if (!selectedEvent) return;
    if (!visitor) {
      setError(null);
      setQuickRegister({ action: "event", tab: "new" });
      return;
    }
    await submitEventRegistration(visitor, visitSession?.visit_session_id);
  }

  async function submitEventRegistration(activeVisitor: Visitor, visitSessionId?: number) {
    if (!selectedEvent) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/kiosk/events/select", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: activeVisitor.visitor_id,
          visit_session_id: visitSessionId,
          event_id: selectedEvent.event_id,
        }),
      });
      showConfirmation({
        title: "Event Registration Confirmed",
        message: `You are registered for ${selectedEvent.event_name}. Please be seated 10 minutes before the event starts.`,
        pass: {
          status: "Registered for event",
          name: activeVisitor.visitor_name,
          placeLabel: "Event",
          place: selectedEvent.event_name,
          date: formatPassDate(todayIso()),
          time: formatSlot(formatTime(selectedEvent.event_time_start)),
          timeDetail: selectedEvent.event_location,
          note: "Please be seated 10 minutes before the event starts.",
        },
      });
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : "Could not select event.");
    } finally {
      setBusy(false);
    }
  }

  // Opening the visitor pass animates like a screen change: the header
  // logo flies down into the pass's countdown logo.
  function showConfirmation(next: ConfirmationState) {
    withViewTransition(() => setConfirmation(next), "overlay");
  }

  function continueToServices() {
    setConfirmation(null);
    setSelectedEvent(null);
    setStep("service-selection");
  }



  // Recognition problems usually come from people who weren't recognised,
  // so this doesn't need a visitor profile. capture_id (when there is one)
  // links the report to the face scan that went wrong.
  async function handleIssueSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = issueText.trim();
    if (!message) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/kiosk/recognition-issues", {
        method: "POST",
        body: JSON.stringify({
          message,
          capture_id: captureId ?? null,
          visitor_id: visitor?.visitor_id ?? null,
        }),
      });
      setThankYouKind("report");
      setStep("thank-you");
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Could not send your message. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOtherSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visitor) {
      setStep("thank-you");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/kiosk/other-assistance", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          visit_session_id: visitSession?.visit_session_id,
          reason: otherReason,
          notes: otherNotes || "Submitted from kiosk",
        }),
      });
      setStep("thank-you");
    } catch (assistError) {
      setError(assistError instanceof Error ? assistError.message : "Could not submit request.");
    } finally {
      setBusy(false);
    }
  }

  const bookingTitle =
    selectedService === "podcast_studio"
      ? "Book the Podcast Studio"
      : selectedService === "tiktok_studio"
        ? "Book TikTok Studio"
        : "Book a Meeting Room";

  const onStart = step === "start" || step === "identify";

  // One countdown for every "visit finished" moment. Confirmations go
  // straight back to the start (no extra thank-you screen in between);
  // tapping "Other services" on the dialog cancels it.
  const visitFinished = step === "thank-you" || confirmation !== null;
  const returnSeconds = confirmation ? PASS_RETURN_SECONDS : AUTO_RETURN_SECONDS;
  const secondsLeft = useCountdown(visitFinished, returnSeconds, finishVisit, confirmation ?? step);

  return (
    <main className="kiosk-stage">
      <div className="kiosk-frame" data-voice={voiceOpen ? "on" : "off"}>
        <KioskBackdrop
          photo={
            step === "booking"
              ? ROOM_PHOTOS[bookingForm.zoneId] ?? ROOM_PHOTOS.MR_1
              : step === "booking-podcast"
                ? ROOM_PHOTOS.podcast_studio
                : step === "booking-tiktok"
                  ? ROOM_PHOTOS.tiktok_studio
                  : undefined
          }
        />
        {/* On the finish screens the header logo hands over to the countdown
            logo (it flies down into it), so the header one isn't shown. */}
        <TopBar morphMark showBrand={step !== "start" && step !== "thank-you" && !confirmation} />

        <section className="kiosk-panel">
          {step !== "start" ? <PanelBrand /> : null}
          {error && !quickRegister ? <StatusBanner tone="error" message={error} /> : null}

          {step === "start" ? (
            <Screen hero>
              <BrandHero />
              <Eyebrow key={presence} label={START_TEXT[presence].eyebrow} />
              <div className="hero-texts">
                <Typewriter
                  as="h1"
                  className="hero-title"
                  onDone={() => {
                    if (presence === "engaged") setGreetingReady(true);
                  }}
                  text={START_TEXT[presence].title}
                />
                <Typewriter
                  className={presence === "idle" ? "hero-copy idle" : "hero-copy"}
                  delayMs={presence === "engaged" ? 700 : 900}
                  eraseMs={10}
                  text={START_TEXT[presence].copy}
                  typeMs={24}
                />
              </div>
            </Screen>
          ) : null}

          {step === "identify" ? (
            <Screen>
              <TitleBlock eyebrow="Check in">
                How would you like
                <br />
                to continue?
              </TitleBlock>
              <div className={facecheckSuggestions && facecheckSuggestions.length > 0 ? "options-section tight" : "options-section"}>
                {facecheckSuggestions && facecheckSuggestions.length > 0 ? (
                  <>
                    <Divider>Do any of these look like your profile?</Divider>
                    <div className="match-row">
                      {facecheckSuggestions.map((candidate) => (
                        <button
                          className="glass-card match-card"
                          disabled={busy}
                          key={candidate.rank}
                          onClick={handleFaceCheckRespond}
                          type="button"
                        >
                          <span className="match-head">
                            <span className="dim">Match</span>
                            <span>{typeof candidate.score === "number" ? `${Math.round(candidate.score * 100)}%` : ""}</span>
                          </span>
                          <span className="match-photo">
                            {candidate.thumbnail_base64 ? (
                              <img alt="" src={candidate.thumbnail_base64} />
                            ) : (
                              <span>{candidate.rank}</span>
                            )}
                          </span>
                          <span className="match-name">{suggestionLabel(candidate)}</span>
                          <CornerTick />
                        </button>
                      ))}
                    </div>
                    <Divider>None of these options — choose one of the options</Divider>
                  </>
                ) : (
                  <Divider>We couldn&rsquo;t find your profile — choose one of the options</Divider>
                )}
                <div className="card-grid">
                  {identifyOptions.map((option) => (
                    <button
                      className="glass-card option-card"
                      disabled={busy}
                      key={option.id}
                      onClick={() => handleIdentifyOption(option.id)}
                      type="button"
                    >
                      <option.icon />
                      <span className="card-label">
                        {option.label}
                      </span>
                      <CornerTick />
                    </button>
                  ))}
                </div>
              </div>
            </Screen>
          ) : null}

          {step === "service-selection" ? (
            <Screen>
              <TitleBlock eyebrow="Welcome">
                What brings you to
                <br />
                Innovation City today?
              </TitleBlock>
              <div className="options-section">
                <Divider>Talk to the assistant or select an option</Divider>
                <div className="card-grid">
                  {serviceCards.map((card) => (
                    <button
                      className="glass-card service-card"
                      disabled={busy}
                      key={card.id}
                      onClick={() => handleServiceSelect(card.id)}
                      type="button"
                    >
                      <card.icon />
                      <span className="service-title">{card.title}</span>
                      <span className="service-copy">{card.description}</span>
                      <CornerTick />
                    </button>
                  ))}
                </div>
              </div>
            </Screen>
          ) : null}

          {step === "profile-lookup" ? (
            <Screen onBack={() => setStep("identify")}>
              <TitleBlock eyebrow="Check in">Find your profile</TitleBlock>
              <p className="screen-copy">Enter your details so we can find your profile.</p>
              <form className="stack" onSubmit={handleProfileLookup}>
                <Panel>
                  <Field
                    icon={<User />}
                    label="Full name"
                    onChange={(event) => setLookup((value) => ({ ...value, full_name: event.target.value }))}
                    placeholder="Enter your full name"
                    required
                    value={lookup.full_name}
                  />
                  <Field
                    icon={<Phone />}
                    label="Mobile number"
                    onChange={(event) => setLookup((value) => ({ ...value, mobile_number: event.target.value.replace(/\D/g, "") }))}
                    placeholder="50 123 4567"
                    required
                    value={lookup.mobile_number}
                    leadingAddon={
                      <CountryCodeSelect
                        onChange={(countryCode) => setLookup((value) => ({ ...value, country_code: countryCode }))}
                        value={lookup.country_code}
                      />
                    }
                  />
                </Panel>
                <PrimaryButton disabled={busy} type="submit">Continue</PrimaryButton>
                <p className="inline-note">
                  Don&rsquo;t have a profile?{" "}
                  <button onClick={handleRegisterLink} type="button">Create one</button>
                </p>
              </form>
            </Screen>
          ) : null}

          {step === "register" ? (
            <Screen onBack={() => setStep("identify")}>
              <TitleBlock eyebrow="New profile">Create your profile</TitleBlock>
              <p className="screen-copy">Fill in your details, or tell the assistant.</p>
              <form className="stack" onSubmit={handleRegistration}>
                <Panel>
                  <Field
                    label="Full name"
                    onChange={(event) => setRegistration((value) => ({ ...value, full_name: event.target.value }))}
                    placeholder="Enter your name"
                    required
                    value={registration.full_name}
                  />
                  <Field
                    label="Mobile number"
                    onChange={(event) => setRegistration((value) => ({ ...value, mobile_number: event.target.value.replace(/\D/g, "") }))}
                    placeholder="50 123 4567"
                    required
                    value={registration.mobile_number}
                    leadingAddon={
                      <CountryCodeSelect
                        onChange={(countryCode) => setRegistration((value) => ({ ...value, country_code: countryCode }))}
                        value={registration.country_code}
                      />
                    }
                  />
                  <Field
                    label="Email address"
                    onChange={(event) => setRegistration((value) => ({ ...value, email: event.target.value }))}
                    placeholder="name@company.com"
                    required
                    type="email"
                    value={registration.email}
                  />
                  <div className="toggle-field">
                    <span>I am visiting as</span>
                    <div className="segmented-toggle">
                      {(["client", "visitor"] as const).map((type) => (
                        <button
                          className={registration.visitor_type === type ? "active" : ""}
                          key={type}
                          onClick={() => setRegistration((value) => ({ ...value, visitor_type: type }))}
                          type="button"
                        >
                          {type === "client" ? "Client" : "Visitor"}
                        </button>
                      ))}
                    </div>
                  </div>
                </Panel>
                <PrimaryButton disabled={busy} type="submit">Continue</PrimaryButton>
              </form>
            </Screen>
          ) : null}

          {step === "facial-consent" ? (
            <Screen>
              <TitleBlock eyebrow="Faster check-in">
                Recognise me
                <br />
                next time?
              </TitleBlock>
              <p className="screen-copy">A face scan lets the kiosk welcome you by name on your next visit.</p>
              <button className="glass-card consent-card" onClick={() => setConsentChecked((value) => !value)} type="button">
                <span className="check-box">{consentChecked ? <Check /> : null}</span>
                <span>I understand and consent to using facial recognition for future check-ins.</span>
              </button>
              <PrimaryButton disabled={busy || !consentChecked} onClick={() => handleConsent(true)}>
                Yes, enable face check-in
              </PrimaryButton>
              <OutlineButton disabled={busy} onClick={() => handleConsent(false)}>
                Continue without face scan
              </OutlineButton>
            </Screen>
          ) : null}

          {step === "scan-progress" && !kycPhase ? (
            // Only visible if the scanner isn't open (e.g. camera failed
            // before it could start) -- normally the scanner covers this.
            <Screen>
              <TitleBlock eyebrow="Face scan">Face scan</TitleBlock>
              {enrollmentError ? <StatusBanner tone="error" message={enrollmentError} /> : null}
              <PrimaryButton
                disabled={busy}
                onClick={() => {
                  kycCancelledRef.current = false;
                  setKycMode("enroll");
                  setKycPhase("starting");
                }}
              >
                Scan again
              </PrimaryButton>
              <OutlineButton disabled={busy} onClick={skipFaceEnrollment}>Continue without face scan</OutlineButton>
            </Screen>
          ) : null}

          {step === "welcome-back" ? (
            <Screen>
              <TitleBlock eyebrow="Welcome back">
                Good to see you,
                <br />
                {firstName}
              </TitleBlock>
              <Panel>
                {currentBookings.length > 0 ? (
                  <>
                    <div className="mini-heading">
                      <CalendarDays />
                      <div>
                        <strong>{currentBookings.length === 1 ? "Your booking today" : `Your ${currentBookings.length} bookings today`}</strong>
                        <span>Use Find a place for directions to your room.</span>
                      </div>
                    </div>
                    <div className="booking-summary-list">
                      {currentBookings.map((booking) => (
                        <div className="booking-summary-item" key={booking.booking_id}>
                          <b>{formatTime(booking.booking_time_start)} – {formatTime(booking.booking_time_end)}</b>
                          <span>{booking.room_name}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <strong>No bookings today</strong>
                    <p className="panel-copy">Talk to the assistant or pick a service to get started.</p>
                  </>
                )}
              </Panel>
              <PrimaryButton onClick={() => setStep(currentBookings.length > 0 ? "thank-you" : "service-selection")}>
                {currentBookings.length > 0 ? "Finish" : "See services"}
              </PrimaryButton>
              {currentBookings.length > 0 ? (
                <OutlineButton onClick={() => setStep("service-selection")}>Other services</OutlineButton>
              ) : null}
            </Screen>
          ) : null}

          {step === "room-select" ? (
            <Screen onBack={() => setStep("service-selection")}>
              <TitleBlock eyebrow="Booking">Choose your room</TitleBlock>
              <div className="room-choice-list">
                {(["MR_1", "MR_2"] as const).map((zoneId) => (
                  <RoomChoiceCard
                    description={roomDescription(zoneId)}
                    facts={ROOM_FACTS[zoneId]}
                    key={zoneId}
                    label={zoneId === "MR_1" ? "Meeting Room 1" : "Meeting Room 2"}
                    onChoose={() => {
                      setBookingForm((value) => ({ ...value, zoneId }));
                      setStep("booking");
                    }}
                    selected={bookingForm.zoneId === zoneId}
                    src={ROOM_PHOTOS[zoneId]}
                  />
                ))}
              </div>
            </Screen>
          ) : null}

          {step === "booking" || step === "booking-podcast" || step === "booking-tiktok" ? (
            <Screen onBack={() => setStep(step === "booking" ? "room-select" : "service-selection")}>
              <TitleBlock eyebrow="Booking">{bookingTitle}</TitleBlock>
              <BookingFormPanel
                bookingForm={bookingForm}
                busy={busy}
                onChange={setBookingForm}
                onSubmit={handleBooking}
                service={selectedService}
              />
            </Screen>
          ) : null}

          {step === "events" ? (
            <Screen scroll onBack={() => setStep("service-selection")}>
              <TitleBlock eyebrow="Events">Today&rsquo;s events</TitleBlock>
              <div className="event-list">
                {events.length === 0 ? <Panel><strong>No events are scheduled for today.</strong></Panel> : null}
                {events.map((eventItem) => (
                  <button
                    className={["glass-card", "event-card", selectedEvent?.event_id === eventItem.event_id ? "selected" : ""].join(" ")}
                    key={eventItem.event_id}
                    onClick={() => setSelectedEvent(eventItem)}
                    type="button"
                  >
                    <strong>{eventItem.event_name}</strong>
                    <span>{formatTime(eventItem.event_time_start)} · {eventItem.event_location}</span>
                    <CornerTick />
                  </button>
                ))}
              </div>
              {selectedEvent ? (
                <p className="screen-copy">Please be seated 10 minutes before {selectedEvent.event_name} starts.</p>
              ) : null}
              <PrimaryButton disabled={busy || !selectedEvent} onClick={handleEventRegistration}>
                Register for event
              </PrimaryButton>
            </Screen>
          ) : null}

          {step === "center" ? (
            <Screen scroll onBack={() => setStep("service-selection")}>
              <TitleBlock eyebrow="Find a place">Explore the center</TitleBlock>
              <p className="screen-copy">Ask Sky about any room on the floor, or browse below.</p>
              <div className="room-info-list">
                {centerRoomOptions.map((option) => (
                  <div className="glass-card room-info" key={option.title}>
                    <strong>{option.title}</strong>
                    <span>{option.description}</span>
                  </div>
                ))}
              </div>
              {!voiceOpen ? (
                <PrimaryButton onClick={() => setVoiceOpen(true)} icon={<Mic />}>Ask Sky</PrimaryButton>
              ) : null}
            </Screen>
          ) : null}

          {step === "other" ? (
            <Screen onBack={() => setStep("service-selection")}>
              <TitleBlock eyebrow="Support">How can we help?</TitleBlock>
              <form className="stack" onSubmit={handleOtherSubmit}>
                <Panel>
                  <KioskSelect
                    label="Reason for your visit"
                    onChange={setOtherReason}
                    options={[
                      { value: "start_company", label: "Start your company" },
                      { value: "free_zone_questions", label: "Free zone or company setup questions" },
                      { value: "document_creation_renewal", label: "Document creation or renewal" },
                    ]}
                    value={otherReason}
                  />
                  <TextAreaField
                    label="Notes for the CX team"
                    onChange={(event) => setOtherNotes(event.target.value)}
                    placeholder="Anything we should know"
                    value={otherNotes}
                  />
                </Panel>
                <PrimaryButton disabled={busy} type="submit">Send to CX team</PrimaryButton>
              </form>
            </Screen>
          ) : null}

          {step === "report-issue" ? (
            <Screen onBack={() => setStep("identify")}>
              <TitleBlock eyebrow="Recognition issue">
                We&rsquo;re sorry
                <br />
                about that
              </TitleBlock>
              <p className="screen-copy">
                Something didn&rsquo;t go right with recognising you. We&rsquo;d love to hear what happened so we can
                fix it.
              </p>
              <form className="stack" onSubmit={handleIssueSubmit}>
                <Panel>
                  <TextAreaField
                    label="Tell us what happened"
                    maxLength={1000}
                    onChange={(event) => setIssueText(event.target.value)}
                    placeholder="For example: it showed someone else's profile, or it didn't find mine."
                    rows={6}
                    value={issueText}
                  />
                </Panel>
                <PrimaryButton disabled={busy || !issueText.trim()} type="submit">
                  Send
                </PrimaryButton>
              </form>
            </Screen>
          ) : null}

          {step === "thank-you" ? (
            <Screen hero>
              <div className="hero-texts">
                {thankYouKind === "report" ? (
                  <>
                    <h1 className="screen-title">
                      Thanks for
                      <br />
                      letting us know
                    </h1>
                    <p className="hero-copy">Our team will look into it. We&rsquo;re sorry for the trouble.</p>
                  </>
                ) : (
                  <>
                    <h1 className="screen-title">
                      Thank you
                      <br />
                      for visiting
                    </h1>
                    <p className="hero-copy">Enjoy your time at Innovation City.</p>
                  </>
                )}
              </div>
              <PrimaryButton onClick={finishVisit}>Start over now</PrimaryButton>
              {/* Below the button on purpose: when it ends, the logo circle
                  flies *up* into the welcome screen's big logo. */}
              <div className="thank-countdown">
                <LogoCountdown seconds={AUTO_RETURN_SECONDS} secondsLeft={secondsLeft} />
              </div>
            </Screen>
          ) : null}
        </section>

        <VoiceAssistant
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          knownVisitor={
            visitor
              ? { visitor_id: visitor.visitor_id, visitor_name: visitor.visitor_name, visitor_type: visitor.visitor_type }
              : null
          }
          onNeedFaceEnrollment={handleVoiceFaceEnrollment}
          onFormFieldUpdate={handleVoiceFormFieldUpdate}
          onSkyStateChange={setSkyState}
        />

        <BottomNav
          firstTab={onStart ? "plan" : "home"}
          onFirstTab={onStart ? () => setStep("service-selection") : goHome}
          onFindPlace={() => setStep("center")}
          onSky={handleSkyPress}
          skyState={skyState}
        />

        {quickRegister ? (
          <div className="frame-modal" onClick={(event) => event.target === event.currentTarget && setQuickRegister(null)}>
            <form className="quick-register" onSubmit={handleQuickRegister}>
              <div className="qr-head">
                <span className="eyebrow">
                  <EyebrowMark />
                  {quickRegister.action === "booking" ? "Almost there" : "One more step"}
                </span>
                <h2>{quickRegister.tab === "new" ? "Quick registration" : "Find your profile"}</h2>
                <p>
                  {quickRegister.action === "booking"
                    ? "Your chosen time is saved — we just need your details to confirm the booking."
                    : "We just need your details to register you for the event."}
                </p>
              </div>

              <div className="segmented-toggle qr-tabs" role="tablist">
                {(["new", "existing"] as const).map((tab) => (
                  <button
                    aria-selected={quickRegister.tab === tab}
                    className={quickRegister.tab === tab ? "active" : ""}
                    key={tab}
                    onClick={() => {
                      setError(null);
                      setQuickRegister({ ...quickRegister, tab });
                    }}
                    role="tab"
                    type="button"
                  >
                    {tab === "new" ? "I'm new" : "I have a profile"}
                  </button>
                ))}
              </div>

              {error ? <StatusBanner tone="error" message={error} /> : null}

              {quickRegister.tab === "new" ? (
                <div className="qr-fields">
                  <Field
                    label="Full name"
                    onChange={(event) => setRegistration((value) => ({ ...value, full_name: event.target.value }))}
                    placeholder="Enter your name"
                    required
                    value={registration.full_name}
                  />
                  <Field
                    label="Mobile number"
                    leadingAddon={
                      <CountryCodeSelect
                        onChange={(countryCode) => setRegistration((value) => ({ ...value, country_code: countryCode }))}
                        value={registration.country_code}
                      />
                    }
                    onChange={(event) => setRegistration((value) => ({ ...value, mobile_number: event.target.value.replace(/\D/g, "") }))}
                    placeholder="50 123 4567"
                    required
                    value={registration.mobile_number}
                  />
                  <Field
                    label="Email address"
                    onChange={(event) => setRegistration((value) => ({ ...value, email: event.target.value }))}
                    placeholder="name@company.com"
                    required
                    type="email"
                    value={registration.email}
                  />
                  <div className="toggle-field">
                    <span>I am visiting as</span>
                    <div className="segmented-toggle">
                      {(["client", "visitor"] as const).map((type) => (
                        <button
                          className={registration.visitor_type === type ? "active" : ""}
                          key={type}
                          onClick={() => setRegistration((value) => ({ ...value, visitor_type: type }))}
                          type="button"
                        >
                          {type === "client" ? "Client" : "Visitor"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="qr-fields">
                  <Field
                    icon={<User />}
                    label="Full name"
                    onChange={(event) => setLookup((value) => ({ ...value, full_name: event.target.value }))}
                    placeholder="Enter your full name"
                    required
                    value={lookup.full_name}
                  />
                  <Field
                    label="Mobile number"
                    leadingAddon={
                      <CountryCodeSelect
                        onChange={(countryCode) => setLookup((value) => ({ ...value, country_code: countryCode }))}
                        value={lookup.country_code}
                      />
                    }
                    onChange={(event) => setLookup((value) => ({ ...value, mobile_number: event.target.value.replace(/\D/g, "") }))}
                    placeholder="50 123 4567"
                    required
                    value={lookup.mobile_number}
                  />
                </div>
              )}

              <div className="pass-actions">
                <OutlineButton
                  onClick={() => {
                    setError(null);
                    setQuickRegister(null);
                  }}
                  type="button"
                >
                  Cancel
                </OutlineButton>
                <PrimaryButton disabled={busy} type="submit">
                  {quickRegister.action === "booking" ? "Confirm booking" : "Join event"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        ) : null}

        {kycPhase ? (
          <FaceScanOverlay
            onCameraError={(message) => {
              setError(message);
              setKycPhase("error");
            }}
            errorActions={
              kycMode === "enroll" ? (
                <>
                  <PrimaryButton
                    disabled={busy}
                    onClick={() => {
                      kycCancelledRef.current = false;
                      if (kycStreamRef.current) runKycEnroll(kycStreamRef.current);
                    }}
                  >
                    Scan again
                  </PrimaryButton>
                  <OutlineButton
                    disabled={busy}
                    onClick={() => {
                      setKycPhase(null);
                      skipFaceEnrollment();
                    }}
                  >
                    Continue without face scan
                  </OutlineButton>
                </>
              ) : undefined
            }
            mode={kycMode}
            onCancel={cancelKycScan}
            onStream={handleKycStream}
            phase={kycPhase}
            scanMs={KYC_SCAN_MS}
          />
        ) : null}

        {confirmation ? (
          <div className="frame-modal">
            <div className="pass-stack">
              <VisitorPass pass={confirmation.pass} />
              <LogoCountdown seconds={PASS_RETURN_SECONDS} secondsLeft={secondsLeft} />
              <div className="pass-actions">
                <OutlineButton onClick={continueToServices}>Book something else</OutlineButton>
                <PrimaryButton onClick={finishVisit}>Done</PrimaryButton>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Counts down from `seconds` while `active`, then calls `onDone` once.
 * `restartKey` restarts the count when a new finish moment replaces the
 * old one. Measured against the clock (not tick counts) so a busy main
 * thread can't stretch the 5 seconds.
 */
function useCountdown(active: boolean, seconds: number, onDone: () => void, restartKey: unknown) {
  const [left, setLeft] = useState(seconds);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setLeft(seconds);
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = seconds - Math.floor((Date.now() - startedAt) / 1000);
      if (remaining <= 0) {
        window.clearInterval(timer);
        onDoneRef.current();
      } else {
        setLeft(remaining);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [active, seconds, restartKey]);

  return left;
}

function suggestionLabel(candidate: FaceCheckSuggestion) {
  if (candidate.name) return candidate.name;
  // FaceCheckID returns a source page, not a name -- show its site instead.
  try {
    return new URL(candidate.source_url).hostname.replace(/^www\./, "");
  } catch {
    return `Match ${candidate.rank}`;
  }
}

function KioskBackdrop({ photo }: { photo?: string }) {
  // "Brand aurora": soft clouds of the logo's cyan and purple drifting over
  // deep navy -- the same on every screen. Each cloud only moves/scales
  // (GPU-cheap); they pause while the voice assistant is on (see
  // .kiosk-frame[data-voice] in the CSS).
  return (
    <div aria-hidden className="kiosk-backdrop">
      <div className="aurora" data-paused={photo ? "true" : "false"}>
        <span className="aurora-blob a1" />
        <span className="aurora-blob a2" />
        <span className="aurora-blob a3" />
        <span className="aurora-blob a4" />
      </div>
      {/* Booking screens: the chosen room's photo, softly blurred, sets the
          mood behind the form. Keyed so switching rooms cross-fades. */}
      {photo ? <PhotoImg alt="" className="backdrop-photo" key={photo} src={photo} /> : null}
      <div className="kiosk-backdrop-shade" />
    </div>
  );
}

function TopBar({ showBrand, morphMark }: { showBrand: boolean; morphMark: boolean }) {
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<{ temp: number } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Open-Meteo (free, no key) for Ras Al Khaimah. Refreshes every 15 min
  // and fails silently -- the header still shows date/time without it.
  useEffect(() => {
    let cancelled = false;
    async function loadWeather() {
      try {
        const res = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=25.7895&longitude=55.9432&current_weather=true",
        );
        const data = await res.json();
        if (!cancelled && data?.current_weather) {
          setWeather({ temp: Math.round(data.current_weather.temperature) });
        }
      } catch {
        // nice-to-have only
      }
    }
    loadWeather();
    const interval = setInterval(loadWeather, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const timeZone = "Asia/Dubai";
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  const day = now.toLocaleDateString("en-US", { weekday: "long", timeZone });
  const date = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone });

  return (
    <header className="top-bar">
      {showBrand ? <HeaderBrand morphMark={morphMark} /> : null}
      <div className="top-block">
        <p className="top-value">{weather ? `${weather.temp} C°` : "-- C°"}</p>
        <p className="top-meta">
          <span>UAE</span>
          <i />
          <span className="dim">Ras Al Khaimah</span>
        </p>
      </div>
      <div className="top-block end">
        <p className="top-value">{time}</p>
        <p className="top-meta">
          <span>{day}</span>
          <i />
          <span className="dim">{date}</span>
        </p>
      </div>
    </header>
  );
}

function BottomNav({
  firstTab,
  onFirstTab,
  onFindPlace,
  onSky,
  skyState,
}: {
  firstTab: "plan" | "home";
  onFirstTab: () => void;
  onFindPlace: () => void;
  onSky: () => void;
  skyState: SkyState;
}) {
  const active = skyState !== "off";
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-row">
        <button className="nav-tab" onClick={onFirstTab} type="button">
          <span className="nav-icon">{firstTab === "plan" ? <PlanVisitIcon /> : <HomeIcon />}</span>
          <span className="nav-label">{firstTab === "plan" ? "Plan your visit" : "Home"}</span>
        </button>
        <button
          aria-label={active ? "Stop the AI voice assistant" : "Start the AI voice assistant"}
          aria-pressed={active}
          className={active ? "nav-tab sky active" : "nav-tab sky"}
          onClick={onSky}
          type="button"
        >
          <span className="nav-icon sky-slot">
            <SkyFace height={220} state={skyState} />
          </span>
          <span className="nav-label">AI voice assistant</span>
        </button>
        <button className="nav-tab" onClick={onFindPlace} type="button">
          <span className="nav-icon"><FindPlaceIcon /></span>
          <span className="nav-label">Find a place</span>
        </button>
      </div>
    </nav>
  );
}

function Eyebrow({ label }: { label: string }) {
  return (
    <span className="eyebrow">
      <EyebrowMark />
      {label}
    </span>
  );
}

function TitleBlock({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="title-block">
      <Eyebrow label={eyebrow} />
      <h1 className="screen-title">{children}</h1>
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <p className="divider">
      <i />
      <span>{children}</span>
      <i />
    </p>
  );
}

function CornerTick() {
  return (
    <span aria-hidden className="corner-tick">
      <i />
      <i />
    </span>
  );
}

function Screen({
  children,
  hero = false,
  scroll = false,
  onBack,
}: {
  children: React.ReactNode;
  hero?: boolean;
  scroll?: boolean;
  /** Shows the back arrow at the top-left of the panel. */
  onBack?: () => void;
}) {
  return (
    <div className={["screen", hero ? "screen-hero" : "", scroll ? "screen-scroll" : ""].filter(Boolean).join(" ")}>
      <div className="screen-body">
        {onBack ? (
          <button
            aria-label="Back"
            className="back-btn"
            onClick={() => {
              navigateBack();
              onBack();
            }}
            type="button"
          >
            <span className="back-circle">
              <ArrowLeft aria-hidden />
            </span>
            <span className="back-label">Back</span>
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function Panel({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={compact ? "glass-card panel compact" : "glass-card panel"}>{children}</div>;
}

function PrimaryButton({
  children,
  disabled,
  icon,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button className="primary-btn" disabled={disabled} onClick={onClick} type={type}>
      {icon ? <span className="btn-icon">{icon}</span> : null}
      {children}
    </button>
  );
}

function OutlineButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button className="outline-btn" disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  );
}

function Field({
  label,
  leadingAddon,
  icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  leadingAddon?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className={["input-wrap", leadingAddon ? "with-prefix" : "", icon && !leadingAddon ? "with-icon" : ""].join(" ")}>
        {leadingAddon ? <span className="input-prefix">{leadingAddon}</span> : null}
        {icon && !leadingAddon ? <span className="input-icon">{icon}</span> : null}
        <input {...props} />
      </span>
    </label>
  );
}

function TextAreaField({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-wrap">
        <textarea {...props} />
      </span>
    </label>
  );
}

function StatusBanner({ message, tone }: { message: string; tone: "error" | "success" }) {
  return (
    <div className={`status-banner ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "success" ? <Check /> : null}
      {message}
    </div>
  );
}


function CountryCodeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <KioskSelect
      onChange={onChange}
      options={countryCodeOptions.map(([code, label]) => ({ value: code, label: `${code}  ${label}` }))}
      value={value}
      variant="compact"
    />
  );
}

// Start times can be set to any SLOT_STEP_MINUTES minute, from opening time
// up to the latest allowed start. A time is only reachable in the picker if
// it hasn't passed yet and at least one duration still fits before closing
// -- so visitors can only pick times the booking will actually accept.
// BOOKING_DAYS_AHEAD = how far ahead the date picker goes (day/month/year).
const SLOT_STEP_MINUTES = 5;
const BOOKING_DAYS_AHEAD = 365;

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatSlot(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function timeSlotsFor(date: string): KioskOption[] {
  if (!date) return [];
  const slots: KioskOption[] = [];
  for (let t = toMinutes(OPERATING_HOURS_START); t <= toMinutes(LATEST_BOOKING_START); t += SLOT_STEP_MINUTES) {
    const time = fromMinutes(t);
    if (isPastDateTime(date, time)) continue;
    if (bookingDurationOptions(time).length === 0) continue;
    slots.push({ value: time, label: formatSlot(time) });
  }
  return slots;
}

function bookingDates(): string[] {
  const [y, m, d] = toDateInputValue().split("-").map(Number);
  const dates: string[] = [];
  for (let i = 0; i < BOOKING_DAYS_AHEAD; i += 1) {
    const value = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    // Only today can run out of times (after hours); future days share the
    // same opening hours, so they're always bookable.
    if (i === 0 && timeSlotsFor(value).length === 0) continue;
    dates.push(value);
  }
  return dates;
}

function BookingFormPanel({
  bookingForm,
  busy,
  onChange,
  onSubmit,
  service,
}: {
  bookingForm: BookingForm;
  busy: boolean;
  onChange: (value: BookingForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  service: ServiceType;
}) {
  const validDates = useMemo(() => bookingDates(), []);
  useEffect(() => preloadRoomPhotos(), []);

  const photo =
    service === "meeting_room"
      ? { src: ROOM_PHOTOS[bookingForm.zoneId] ?? ROOM_PHOTOS.MR_1, label: bookingForm.zoneId === "MR_2" ? "Meeting Room 2" : "Meeting Room 1" }
      : service === "podcast_studio"
        ? { src: ROOM_PHOTOS.podcast_studio, label: "Podcast Studio" }
        : { src: ROOM_PHOTOS.tiktok_studio, label: "TikTok Studio" };
  const photoDescription = service === "meeting_room" ? null : roomDescription(service);
  const photoFacts = service === "meeting_room" ? ROOM_FACTS[bookingForm.zoneId] : ROOM_FACTS[service];
  const validTimes = useMemo(() => timeSlotsFor(bookingForm.date).map((slot) => slot.value), [bookingForm.date]);
  const durationOptions = bookingDurationOptions(bookingForm.time);

  // If the stored date can't be booked any more (e.g. it's after hours
  // today), start on the first day that still has free times.
  useEffect(() => {
    if (validDates.length > 0 && !validDates.includes(bookingForm.date)) {
      onChange({ ...bookingForm, date: validDates[0], time: "", duration: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validDates]);

  function changeDate(date: string) {
    const stillValid = timeSlotsFor(date).some((option) => option.value === bookingForm.time);
    onChange({ ...bookingForm, date, time: stillValid ? bookingForm.time : "", duration: stillValid ? bookingForm.duration : "" });
  }

  function changeTime(time: string) {
    const fits = bookingDurationOptions(time).some((option) => option.value === bookingForm.duration);
    onChange({ ...bookingForm, time, duration: fits ? bookingForm.duration : "" });
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      {/* The room photo; for meeting rooms the room choice sits on it. */}
      <RoomPhoto
        description={photoDescription}
        facts={photoFacts}
        label={photo.label}
        onChange={service === "meeting_room" ? (zoneId) => onChange({ ...bookingForm, zoneId }) : undefined}
        options={
          service === "meeting_room"
            ? [
                { value: "MR_1", label: "Meeting Room 1" },
                { value: "MR_2", label: "Meeting Room 2" },
              ]
            : undefined
        }
        src={photo.src}
        value={bookingForm.zoneId}
      />
      <Panel compact>
        <DatePicker onChange={changeDate} validDates={validDates} value={bookingForm.date} />
        <TimePicker disabled={!bookingForm.date} onChange={changeTime} validTimes={validTimes} value={bookingForm.time} />
        <KioskSelect
          disabled={!bookingForm.time}
          label="Duration"
          placement="up"
          onChange={(duration) => onChange({ ...bookingForm, duration })}
          options={durationOptions}
          placeholder={bookingForm.time ? "Select a duration" : "Select a time first"}
          value={bookingForm.duration}
        />
      </Panel>
      <PrimaryButton
        disabled={busy || !bookingForm.date || !bookingForm.time || !bookingForm.duration}
        icon={<KeyRound />}
        type="submit"
      >
        Reserve slot
      </PrimaryButton>
    </form>
  );
}

function formatTime(value?: string) {
  return value?.slice(0, 5) || "--:--";
}