"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleHelp,
  ClipboardList,
  Home,
  KeyRound,
  Phone,
  Podcast,
  ShieldCheck,
  Sparkles,
  User,
  UserRoundPlus,
  Video,
} from "lucide-react";
import { ApiRequestError, requestJson } from "@/lib/api";
import { VoiceAssistant } from "@/components/kiosk/VoiceAssistant";
import {
  isBookableService,
  nextStepAfterRecognition,
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
  toTimeInputValue,
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
};

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

const todayIso = () => toDateInputValue();

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

const serviceCards: Array<{
  id: ServiceType;
  title: string;
  description: string;
  icon: typeof CalendarDays;
}> = [
  {
    id: "meeting_room",
    title: "Book a Meeting Room",
    description: "Reserve a space for meetings.",
    icon: CalendarDays,
  },
  {
    id: "podcast_studio",
    title: "Book Podcast Studio",
    description: "Record your next session.",
    icon: Podcast,
  },
  {
    id: "tiktok_studio",
    title: "Book TikTok Studio",
    description: "Create content in our studio.",
    icon: Video,
  },
  {
    id: "event",
    title: "Attend an Event",
    description: "Browse and join today's events.",
    icon: ClipboardList,
  },
  {
    id: "business_center",
    title: "Business Center",
    description: "Get voice-guided assistance.",
    icon: BriefcaseBusiness,
  },
  {
    id: "other",
    title: "Other Assistance",
    description: "Connect with our CX team.",
    icon: CircleHelp,
  },
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
  const [step, setStep] = useState<KioskStep>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<number | null>(null);
  const [facecheckSuggestions, setFacecheckSuggestions] = useState<FaceCheckSuggestion[] | null>(null);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "recognized" | "unknown">("idle");
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const autoScanTriggeredRef = useRef(false);
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
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((track) => track.stop());
        previewStreamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        previewStreamRef.current = stream;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        /* camera preview optional; capture flow still handles its own access */
      });

    return () => {
      cancelled = true;
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((track) => track.stop());
        previewStreamRef.current = null;
      }
    };
  }, [step]);

  useEffect(() => {
    if (step !== "start") {
      // Leaving the start screen (visit finished / reset) re-arms the
      // trigger so the *next* visitor's page-open fires a fresh scan.
      autoScanTriggeredRef.current = false;
      return;
    }
    if (autoScanTriggeredRef.current) {
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
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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

  async function handleFaceScan() {
    setBusy(true);
    setError(null);
    setScanState("scanning");
    try {
      const images = await captureFaceSamples(FACE_ENROLLMENT_SAMPLE_COUNT, {
        updateEnrollmentProgress: false,
      });
      const result = await requestJson<RecognitionResult>("/api/kiosk/recognize-face", {
        method: "POST",
        body: JSON.stringify({ images_base64: images }),
      });

      if (result.recognized && result.visitor_id) {
        setScanState("recognized");
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

      if (result.facecheck_suggestions && result.facecheck_suggestions.length > 0) {
        setScanState("unknown");
        setFacecheckSuggestions(result.facecheck_suggestions);
        return;
      }

      setScanState("idle");
      setStep(nextStepAfterRecognition(false));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Face scan failed.");
      setScanState("idle");
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
        await enrollFaceForVisitor(updatedVisitor);
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
    options: { updateEnrollmentProgress?: boolean } = {},
  ): Promise<string[]> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: FACE_CAPTURE_WIDTH },
        height: { ideal: FACE_CAPTURE_HEIGHT },
      },
      audio: false,
    });
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
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  async function enrollFaceForVisitor(nextVisitor: Visitor) {
    setBusy(true);
    setEnrollmentError(null);
    try {
      const images = await captureFaceSamples(FACE_ENROLLMENT_SAMPLE_COUNT);
      await requestJson<FaceProfileResult>("/api/kiosk/face-profile", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: nextVisitor.visitor_id,
          images_base64: images,
        }),
      });
      await createSession(nextVisitor, "manual");
      setStep("service-selection");
    } catch (enrollError) {
      setEnrollmentError(enrollError instanceof Error ? enrollError.message : "Could not enroll your face.");
    } finally {
      setBusy(false);
    }
  }

  // Narrower than enrollFaceForVisitor above: just captures + saves a face
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

  async function retryFaceEnrollment() {
    const nextVisitor = enrollmentVisitorRef.current || visitor;
    if (!nextVisitor) return;
    setEnrollmentProgress(0);
    setEnrollmentError(null);
    await enrollFaceForVisitor(nextVisitor);
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
      if (service === "meeting_room") setStep("booking");
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
    if (!visitor) {
      setError("Please create or verify a profile first.");
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

    setBusy(true);
    setError(null);
    try {
      const createdBooking = await requestJson<CurrentBooking>("/api/kiosk/bookings", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          visit_session_id: visitSession?.visit_session_id,
          service_type: selectedService,
          zone_id: bookingForm.zoneId,
          booking_date: bookingForm.date,
          booking_time_start: bookingForm.time,
          duration_minutes: Number.parseInt(bookingForm.duration, 10),
        }),
      });
      setConfirmation({
        title: "Booking Confirmed",
        message: `${createdBooking.room_name} is reserved from ${formatTime(createdBooking.booking_time_start)} to ${formatTime(createdBooking.booking_time_end)}.`,
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
    if (!visitor || !selectedEvent) return;

    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/kiosk/events/select", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          visit_session_id: visitSession?.visit_session_id,
          event_id: selectedEvent.event_id,
        }),
      });
      setConfirmation({
        title: "Event Registration Confirmed",
        message: `You are registered for ${selectedEvent.event_name}. Please be seated 10 minutes before the event starts.`,
      });
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : "Could not select event.");
    } finally {
      setBusy(false);
    }
  }

  function continueToServices() {
    setConfirmation(null);
    setSelectedEvent(null);
    setStep("service-selection");
  }

  function finishConfirmedAction() {
    setConfirmation(null);
    setStep("thank-you");
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

  return (
    <main className="min-h-screen bg-[#efefef] text-white">
      <section className="mx-auto grid min-h-screen place-items-center">
        <div className="kiosk-frame">
          <TopBar />
          <div className="kiosk-content" style={{ paddingBottom: "56px" }}>
            {error ? <StatusBanner tone="error" message={error} /> : null}

            {step === "start" ? (
              <Screen>
                <ScreenTitle title="Welcome to Innovation City" center />
                <p className="screen-copy text-center">Please look at the camera while we check your registration.</p>
                <LiveFaceOrb
                  videoRef={previewVideoRef}
                  label={busy ? "SCANNING FACE..." : "READY TO SCAN"}
                  scanState={scanState}
                />
                <PrimaryButton disabled={busy} onClick={handleFaceScan}>
                  {busy ? "Scanning..." : "Start Face Scan"}
                </PrimaryButton>
              </Screen>
            ) : null}

            {step === "profile-lookup" ? (
              <Screen>
                <ScreenTitle title="Face Not Recognized" fontSize="20px" />
                <p className="screen-copy">Please enter your details so we can find your profile</p>
                <form className="stack" onSubmit={handleProfileLookup}>
                  <Panel>
                    <Field
                      icon={<User size={18} />}
                      label="Full Name"
                      onChange={(event) => setLookup((value) => ({ ...value, full_name: event.target.value }))}
                      placeholder="Enter your full name"
                      required
                      value={lookup.full_name}
                    />
                    <Field
                      icon={<Phone size={18} />}
                      label="Mobile Number"
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
                  <PageVoiceButton onClick={() => setVoiceOpen(true)} />
                  <PrimaryButton disabled={busy} type="submit">Continue</PrimaryButton>
                  <p className="inline-note">
                    Don't have an account?{" "}
                    <button onClick={handleRegisterLink} type="button">Press here to register</button>
                  </p>
                </form>
              </Screen>
            ) : null}

            {step === "register" ? (
              <Screen scroll>
                <ScreenTitle title="Create Your Profile" />
                <p className="screen-copy">Please fill in your details to continue.</p>
                <form className="stack" onSubmit={handleRegistration}>
                  <Panel>
                    <Field
                      label="Full Name"
                      onChange={(event) => setRegistration((value) => ({ ...value, full_name: event.target.value }))}
                      placeholder="Enter your name"
                      required
                      value={registration.full_name}
                    />
                    <Field
                      label="Mobile Number"
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
                      label="Email Address"
                      onChange={(event) => setRegistration((value) => ({ ...value, email: event.target.value }))}
                      placeholder="name@company.com"
                      required
                      type="email"
                      value={registration.email}
                    />
                    <div className="toggle-field">
                      <span>I am visiting as:</span>
                      <div className="segmented-toggle">
                        <button
                          className={registration.visitor_type === "client" ? "active" : ""}
                          onClick={() => setRegistration((value) => ({ ...value, visitor_type: "client" }))}
                          type="button"
                        >
                          Client
                        </button>
                        <button
                          className={registration.visitor_type === "visitor" ? "active" : ""}
                          onClick={() => setRegistration((value) => ({ ...value, visitor_type: "visitor" }))}
                          type="button"
                        >
                          Visitor
                        </button>
                      </div>
                    </div>
                  </Panel>
                  <PageVoiceButton onClick={() => setVoiceOpen(true)} />
                  <div className="screen-actions two">
                    <OutlineButton onClick={() => setStep("profile-lookup")} type="button">Back</OutlineButton>
                    <PrimaryButton disabled={busy} type="submit">Continue</PrimaryButton>
                  </div>
                </form>
              </Screen>
            ) : null}

            {step === "facial-consent" ? (
              <Screen>
                <ScreenTitle title="Enable Faster Check-In?" />
                <p className="screen-copy">Would you like to allow a facial scan to help us recognise you faster on future visits?</p>
                <button className="consent-card" onClick={() => setConsentChecked((value) => !value)} type="button">
                  <span className="check-box">{consentChecked ? <Check /> : null}</span>
                  <span>I understand and consent to using facial recognition for future check-ins.</span>
                </button>
                <PrimaryButton disabled={busy} onClick={() => handleConsent(consentChecked)} icon={<ShieldCheck />}>
                  Yes, Enable Faster Check-In
                </PrimaryButton>
                <OutlineButton disabled={busy} onClick={() => handleConsent(false)}>
                  No, Continue Without Facial Scan
                </OutlineButton>
                <p className="tiny-note">You can continue without facial recognition.</p>
              </Screen>
            ) : null}

            {step === "scan-progress" ? (
              <Screen>
                <ScreenTitle title="Facial Scan in Progress" center />
                <p className="screen-copy text-center">
                  Please look at the camera and stay still while we capture your face profile.
                </p>
                <FaceOrb label={enrollmentError ? "SCAN NEEDS RETRY" : `CAPTURING ${enrollmentProgress}/3`} />
                {enrollmentError ? (
                  <>
                    <StatusBanner tone="error" message={enrollmentError} />
                    <PrimaryButton disabled={busy} onClick={retryFaceEnrollment}>Retry Face Scan</PrimaryButton>
                    <OutlineButton disabled={busy} onClick={skipFaceEnrollment}>
                      Continue Without Facial Scan
                    </OutlineButton>
                  </>
                ) : (
                  <StatusBanner
                    tone="success"
                    message={
                      enrollmentProgress >= 3
                        ? "Finalising your face profile..."
                        : "Your profile has been created. Face enrollment is starting."
                    }
                  />
                )}
              </Screen>
            ) : null}

            {step === "welcome-back" ? (
              <Screen>
                <ScreenTitle title={`Welcome Back, ${firstName}`} />
                <p className="screen-copy">It's great to see you again.</p>
                {currentBookings.length > 0 ? (
                  <Panel>
                    <div className="mini-heading">
                      <CalendarDays />
                      <div>
                        <strong>{currentBookings.length === 1 ? "Booking" : "Bookings"}</strong>
                        <span>
                          {currentBookings.length === 1
                            ? "You have a booking today."
                            : `You have ${currentBookings.length} bookings today.`}
                        </span>
                      </div>
                    </div>
                    <div className="booking-summary-list">
                      {currentBookings.map((booking) => (
                        <div className="booking-summary-item" key={booking.booking_id}>
                          <b>{formatTime(booking.booking_time_start)} - {formatTime(booking.booking_time_end)}</b>
                          <span>{booking.room_name}</span>
                        </div>
                      ))}
                    </div>
                    <p className="panel-copy">You can access the map screen for guidance to your room.</p>
                  </Panel>
                ) : (
                  <Panel>
                    <strong>No booking found for today.</strong>
                    <p className="panel-copy">You can continue to the service options below.</p>
                  </Panel>
                )}
                <PrimaryButton onClick={() => setStep(currentBookings.length > 0 ? "thank-you" : "service-selection")}>
                  Finish
                </PrimaryButton>
                <PageVoiceButton onClick={() => setVoiceOpen(true)} />
                <OutlineButton onClick={() => setStep("service-selection")}>Other Services</OutlineButton>
              </Screen>
            ) : null}

            {step === "service-selection" ? (
              <Screen>
                <ScreenTitle title="How Can We Help You?" />
                <p className="screen-copy">Please select an option below.</p>
                <div className="service-grid">
                  {serviceCards.map((card) => (
                    <button className="service-card" key={card.id} onClick={() => handleServiceSelect(card.id)} type="button">
                      <span className="service-icon"><card.icon /></span>
                      <strong>{card.title}</strong>
                      <span>{card.description}</span>
                    </button>
                  ))}
                </div>
              </Screen>
            ) : null}

            {step === "booking" || step === "booking-podcast" || step === "booking-tiktok" ? (
              <Screen>
                <ScreenTitle title={bookingTitle} />
                <p className="screen-copy">Verify details and reserve your slot.</p>
                <BookingFormPanel
                  bookingForm={bookingForm}
                  busy={busy}
                  onBack={() => setStep("service-selection")}
                  onChange={setBookingForm}
                  onSubmit={handleBooking}
                  service={selectedService}
                />
              </Screen>
            ) : null}

            {step === "events" ? (
              <Screen scroll>
                <ScreenTitle title="Today's Events" />
                <p className="screen-copy">Select an event taking place today at the hub.</p>
                <div className="event-list">
                  {events.length === 0 ? <Panel>No events are scheduled for today.</Panel> : null}
                  {events.map((eventItem) => (
                    <button
                      className={["event-card", selectedEvent?.event_id === eventItem.event_id ? "event-card-selected" : ""].join(" ")}
                      key={eventItem.event_id}
                      onClick={() => setSelectedEvent(eventItem)}
                      type="button"
                    >
                      <strong>{eventItem.event_name}</strong>
                      <span>{formatTime(eventItem.event_time_start)} - {eventItem.event_location}</span>
                      <b>Select</b>
                    </button>
                  ))}
                </div>
                {selectedEvent ? (
                  <div className="selected-event">Selected: {selectedEvent.event_name}. Please be seated 10 minutes before the event starts.</div>
                ) : null}
                <PrimaryButton disabled={busy || !selectedEvent} onClick={handleEventRegistration}>
                  Submit Event Registration
                </PrimaryButton>
                <OutlineButton onClick={() => setStep("service-selection")}>Back</OutlineButton>
              </Screen>
            ) : null}

            {step === "center" ? (
              <Screen scroll>
                <ScreenTitle title="Explore the Center" />
                <p className="screen-copy">Voice assistance is ready. Ask about any room on the floor.</p>
                <VoiceOrb />
                <div className="room-info-list">
                  {centerRoomOptions.map((option) => (
                    <div className="room-info" key={option.title}>
                      <strong>{option.title}</strong>
                      <span>{option.description}</span>
                    </div>
                  ))}
                </div>
                <PrimaryButton onClick={() => setVoiceOpen(true)} icon={<SkyIcon size={18} />}>Start Voice Assistance</PrimaryButton>
                <OutlineButton onClick={() => setStep("service-selection")}>Back</OutlineButton>
              </Screen>
            ) : null}

            {step === "other" ? (
              <Screen>
                <ScreenTitle title="How Can We Help You?" />
                <p className="screen-copy">Please select the reason for your visit.</p>
                <form className="stack" onSubmit={handleOtherSubmit}>
                  <select className="select-field" value={otherReason} onChange={(event) => setOtherReason(event.target.value)}>
                    <option value="start_company">Start your company</option>
                    <option value="free_zone_questions">Free zone or company setup questions</option>
                    <option value="document_creation_renewal">Document creation or renewal</option>
                  </select>
                  <TextAreaField
                    label="Notes for CX"
                    onChange={(event) => setOtherNotes(event.target.value)}
                    placeholder="Add any details we should remember for next time"
                    value={otherNotes}
                  />
                  <PageVoiceButton onClick={() => setVoiceOpen(true)} />
                  <PrimaryButton disabled={busy} type="submit">Submit and Continue to CX Team</PrimaryButton>
                  <OutlineButton onClick={() => setStep("service-selection")} type="button">Back</OutlineButton>
                </form>
              </Screen>
            ) : null}

            {step === "thank-you" ? (
              <Screen>
                <div className="thank-icon"><BriefcaseBusiness /></div>
                <ScreenTitle title="Thank You for Your Visit!" center />
                <p className="screen-copy text-center">We hope you enjoy your time at Innovation City.</p>
                <PrimaryButton onClick={resetFlow} icon={<Home />}>Return to Home</PrimaryButton>
                <p className="tiny-note">This screen will return to home automatically.</p>
              </Screen>
            ) : null}
          </div>
          <FooterHelp />
        </div>
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
      />

      {facecheckSuggestions ? (
        <div className="voice-modal confirmation-modal">
          <div className="confirmation-card suggestions-card">
            <h2>Is This You?</h2>
            <p>We searched publicly available photos and found a few possible matches. Tap yours, or let us know if none match.</p>
            <div className="suggestion-grid">
              {facecheckSuggestions.map((candidate) => (
                <button
                  className="suggestion-option"
                  disabled={busy}
                  key={candidate.rank}
                  onClick={handleFaceCheckRespond}
                  type="button"
                >
                  <span className="suggestion-photo">
                    {candidate.thumbnail_base64 ? (
                      <img alt={`Possible match ${candidate.rank}`} src={candidate.thumbnail_base64} />
                    ) : (
                      candidate.rank
                    )}
                  </span>
                  {typeof candidate.score === "number" ? (
                    <span
                      className="suggestion-score"
                      style={{ fontSize: "0.8rem", opacity: 0.7, display: "block", marginTop: "2px" }}
                    >
                      {Math.round(candidate.score * 100)}% match
                    </span>
                  ) : null}
                  <span className="suggestion-name">Yes, this is me</span>
                </button>
              ))}
            </div>
            <OutlineButton disabled={busy} onClick={handleFaceCheckRespond}>
              None of these — Continue to Registration
            </OutlineButton>
          </div>
        </div>
      ) : null}

      {confirmation ? (
        <div className="voice-modal confirmation-modal">
          <div className="confirmation-card">
            <h2>{confirmation.title}</h2>
            <p>{confirmation.message}</p>
            <PrimaryButton onClick={finishConfirmedAction}>Done</PrimaryButton>
            <OutlineButton onClick={continueToServices}>Back to Other Services</OutlineButton>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function TopBar() {
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<{ temp: number } | null>(null);

  // Live clock -- ticks every second so the displayed time is always real,
  // not a snapshot from when the page loaded.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Real weather via Open-Meteo (free, no API key). Coordinates are Ras Al
  // Khaimah, UAE -- update these if Innovation City is elsewhere. Weather
  // doesn't need second-by-second freshness, so this only refreshes every
  // 15 minutes, and fails silently (header still shows date/time) if the
  // request doesn't succeed.
  useEffect(() => {
    let cancelled = false;
    async function loadWeather() {
      try {
        const res = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=25.7895&longitude=55.9432&current_weather=true"
        );
        const data = await res.json();
        if (!cancelled && data?.current_weather) {
          setWeather({ temp: Math.round(data.current_weather.temperature) });
        }
      } catch {
        // Weather is a nice-to-have -- the header still works without it.
      }
    }
    loadWeather();
    const interval = setInterval(loadWeather, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Explicit timeZone so the header is correct even if the kiosk machine's
  // own OS clock/timezone setting is ever wrong.
  const timeZone = "Asia/Dubai";
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  // Abbreviated to 3 letters (SUN, MON, ...) -- this header now also has to
  // fit a centered logo on a narrow portrait kiosk screen, leaving much
  // less room than a plain weather+clock bar would, so the longest day
  // names ("WEDNESDAY") can't be spelled out without forcing truncation.
  const dayName = now.toLocaleDateString("en-US", { weekday: "short", timeZone }).toUpperCase();
  const monthDayStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone }).toUpperCase();

  const ACCENT = "#8fb1ff";

  const dimTextStyle: React.CSSProperties = {
    fontSize: "7px",
    letterSpacing: "0",
    color: "#8b93a8",
    marginTop: "2px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const valueTextStyle: React.CSSProperties = {
    fontSize: "15px",
    fontWeight: 600,
    color: "#f5f7fb",
    whiteSpace: "nowrap",
  };
  const dividerStyle: React.CSSProperties = {
    width: "1px",
    height: "30px",
    background: "rgba(255,255,255,0.15)",
    flexShrink: 0,
  };

  return (
    <header className="top-bar" style={{ padding: "10px 8px", width: "100%", boxSizing: "border-box" }}>
      <div
        style={{
          // Logo dropped to 26px height (was 32px) -- the previous 32px
          // calculation assumed a 400px-wide kiosk, but the actual
          // reference frame this design is based on is 360px, which
          // leaves meaningfully less room. Recalculated against 360px
          // this time for a real ~13px margin instead of guessing again.
          display: "grid",
          gridTemplateColumns: "1.15fr auto 0.85fr",
          alignItems: "center",
          columnGap: "10px",
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: "12px",
          background: "rgba(255,255,255,0.03)",
          padding: "10px 12px",
        }}
      >
        {/* justifyContent: flex-start now hugs the temperature to the
            OUTER left edge of the pill, with the divider trailing behind
            it (whatever slack space exists sits between the text and the
            divider/logo, not between the text and the pill's edge). */}
        <div style={{ minWidth: 0, textAlign: "left", display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={valueTextStyle}>{weather ? `${weather.temp}°C` : "--°C"}</div>
            <div style={dimTextStyle}>
              <span style={{ color: ACCENT }}>UAE</span> | RAS AL KHAIMAH
            </div>
          </div>
          <div style={{ ...dividerStyle, marginLeft: "10px" }} />
        </div>

        <div className="brand" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img
            alt="Innovation City"
            src="/brand/innovation-city-mark.png"
            style={{ height: "22px", width: "auto" }}
          />
        </div>

        {/* justifyContent: flex-end hugs the time to the OUTER right edge
            of the pill, mirroring the weather side. */}
        <div style={{ minWidth: 0, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ ...dividerStyle, marginRight: "10px" }} />
          <div style={{ minWidth: 0 }}>
            <div style={valueTextStyle}>{timeStr}</div>
            <div style={dimTextStyle}>
              <span style={{ color: ACCENT }}>{dayName}</span> | {monthDayStr}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function FooterHelp() {
  return (
    <footer className="footer-help">
      <p>Please ask an Innovation Hub associate if you require assistance.</p>
    </footer>
  );
}

function Screen({ children, scroll = false }: { children: React.ReactNode; scroll?: boolean }) {
  return <div className={scroll ? "screen screen-scroll" : "screen"}>{children}</div>;
}

function ScreenTitle({ title, center = false, fontSize }: { title: string; center?: boolean; fontSize?: string }) {
  return (
    <h1
      className={center ? "screen-title text-center" : "screen-title"}
      style={fontSize ? { fontSize, whiteSpace: "nowrap" } : undefined}
    >
      {title}
    </h1>
  );
}

function Panel({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={compact ? "panel panel-compact" : "panel"}>{children}</div>;
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
      {icon ? <span>{icon}</span> : null}
      {children}
    </button>
  );
}

function OutlineButton({
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
    <button className="outline-btn" disabled={disabled} onClick={onClick} type={type}>
      {icon ? <span>{icon}</span> : null}
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
    <label className="field" style={{ marginBottom: "14px" }}>
      <span style={{ display: "block", marginBottom: "6px" }}>{label}</span>
      <div className={["input-wrap", leadingAddon ? "with-prefix" : ""].join(" ")} style={{ position: "relative" }}>
        {leadingAddon ? <div className="input-prefix">{leadingAddon}</div> : null}
        {icon && !leadingAddon ? (
          <span
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              color: "rgba(255,255,255,0.4)",
              pointerEvents: "none",
            }}
          >
            {icon}
          </span>
        ) : null}
        <input {...props} style={icon && !leadingAddon ? { paddingLeft: "38px" } : undefined} />
      </div>
    </label>
  );
}

function TextAreaField({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <textarea {...props} />
      </div>
    </label>
  );
}

function SkyIcon({ size = 22, animated = true }: { size?: number; animated?: boolean }) {
  // Aspect ratio from the source art (157x165) so the icon never distorts
  // at different sizes.
  const width = size * (157 / 165);

  // Plain React state driving the morph instead of a CSS @keyframes
  // animation -- simpler to reason about and verify, no dependency on
  // styled-jsx's build-time class scoping working correctly with SVG
  // children. A setInterval flips a boolean; each path's opacity responds
  // via a CSS transition, so the fade itself is still smooth.
  const [smiling, setSmiling] = useState(false);
  useEffect(() => {
    if (!animated) return;
    const interval = setInterval(() => setSmiling((prev) => !prev), 1500);
    return () => clearInterval(interval);
  }, [animated]);

  return (
    <span style={{ position: "relative", display: "inline-block", width, height: size, verticalAlign: "middle" }}>
      <img
        src="/brand/sky-head-base.png"
        alt="Sky"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {/* Position/size corrected: left=24.8%, width=58% match the mouth's
          ACTUAL measured pixel position in the source art exactly (that
          part was always right). The previous version shifted "left" to
          make room for a taller box for the smile dip, WITHOUT adjusting
          width to compensate -- that mismatch is what pushed the line
          past the face's edge on one side. This version only adjusts
          top/height (centered on the original line's vertical center),
          leaving the correct horizontal values untouched. */}
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          top: "39.3%",
          left: "24.8%",
          width: "58%",
          height: "14%",
        }}
      >
        <path
          d="M 28,15 L 72,15"
          stroke="#f5f7fb"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          style={animated ? { opacity: smiling ? 0 : 1, transition: "opacity 0.6s ease-in-out" } : { opacity: 1 }}
        />
        <path
          d="M 28,10 Q 50,27 72,10"
          stroke="#f5f7fb"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          style={animated ? { opacity: smiling ? 1 : 0, transition: "opacity 0.6s ease-in-out" } : { opacity: 0 }}
        />
      </svg>
    </span>
  );
}

function PageVoiceButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="page-voice-btn"
      onClick={onClick}
      type="button"
      style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 18px" }}
    >
      <SkyIcon size={48} />
      <span>Use Voice Assistance</span>
    </button>
  );
}

function CountryCodeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="country-code-picker">
      <select
        aria-label="Country code"
        className="country-code-select"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {countryCodeOptions.map(([code, label]) => (
          <option key={code} value={code}>{code} {label}</option>
        ))}
      </select>
      <span aria-hidden="true">{value}</span>
    </div>
  );
}

function StatusBanner({ message, tone }: { message: string; tone: "error" | "success" }) {
  return <div className={`status-banner ${tone}`}>{tone === "success" ? <Check /> : null}{message}</div>;
}

function FaceOrb({ label }: { label: string }) {
  return (
    <div className="face-area">
      <div className="scan-ring">
        <div className="scan-core"><Sparkles /></div>
      </div>
      <div className="scan-line" />
      <p>{label}</p>
    </div>
  );
}

function LiveFaceOrb({
  videoRef,
  label,
  scanState,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  label: string;
  scanState: "idle" | "scanning" | "recognized" | "unknown";
}) {
  return (
    <div className="face-area">
      <div className={`camera-ring ${scanState === "recognized" ? "recognized" : scanState === "unknown" ? "unknown" : ""}`}>
        <div className="camera-video-wrap">
          <video autoPlay className="camera-video" muted playsInline ref={videoRef} />
          {scanState === "scanning" ? <div className="camera-scanline" /> : null}
        </div>
      </div>
      <p>{label}</p>
    </div>
  );
}

function VoiceOrb() {
  return (
    <div className="voice-orb">
      <div><SkyIcon size={40} /></div>
    </div>
  );
}

function BookingFormPanel({
  bookingForm,
  busy,
  onBack,
  onChange,
  onSubmit,
  service,
}: {
  bookingForm: BookingForm;
  busy: boolean;
  onBack: () => void;
  onChange: (value: BookingForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  service: ServiceType;
}) {
  const minDate = toDateInputValue();
  const currentTime = toTimeInputValue();
  const minTime = bookingForm.date === minDate && currentTime > OPERATING_HOURS_START
    ? currentTime
    : OPERATING_HOURS_START;
  const durationOptions = bookingDurationOptions(bookingForm.time);

  return (
    <form className="stack" onSubmit={onSubmit}>
      <Panel>
        {service === "meeting_room" ? (
          <label className="field">
            <span>Room Type / Room Name</span>
            <select
              className="select-field"
              onChange={(event) => onChange({ ...bookingForm, zoneId: event.target.value })}
              value={bookingForm.zoneId}
            >
              <option value="MR_1">Meeting Room 1</option>
              <option value="MR_2">Meeting Room 2</option>
            </select>
          </label>
        ) : null}
        <Field
          label="Date"
          min={minDate}
          onChange={(event) => {
            const nextDate = event.target.value;
            onChange({
              ...bookingForm,
              date: nextDate,
              time: nextDate === minDate && bookingForm.time && bookingForm.time < (minTime || "")
                ? ""
                : bookingForm.time,
            });
          }}
          required
          type="date"
          value={bookingForm.date}
        />
        <Field
          label="Time"
          min={minTime}
          max={LATEST_BOOKING_START}
          onChange={(event) => {
            const nextTime = event.target.value;
            const nextDurationOptions = bookingDurationOptions(nextTime);
            onChange({
              ...bookingForm,
              time: nextTime,
              duration: nextDurationOptions.some((option) => option.value === bookingForm.duration)
                ? bookingForm.duration
                : "",
            });
          }}
          required
          type="time"
          value={bookingForm.time}
        />
        <label className="field">
          <span>Session Duration</span>
          <select
            className="select-field"
            onChange={(event) => onChange({ ...bookingForm, duration: event.target.value })}
            required
            value={bookingForm.duration}
          >
            <option value="">
              {bookingForm.time && durationOptions.length === 0 ? "Choose a 9 AM - 5 PM time" : "Select duration"}
            </option>
            {durationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </Panel>
      <PrimaryButton disabled={busy} type="submit"><KeyRound /> Submit Request</PrimaryButton>
      <OutlineButton onClick={onBack} type="button">Back</OutlineButton>
    </form>
  );
}

function formatTime(value?: string) {
  return value?.slice(0, 5) || "--:--";
}