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
  Mic,
  Podcast,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
  Video,
} from "lucide-react";
import { ApiRequestError, requestJson } from "@/lib/api";
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

type RecognitionResult = {
  recognized: boolean;
  visitor_id?: number | null;
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
    if (step !== "thank-you") return;
    const timeout = window.setTimeout(resetFlow, 6000);
    return () => window.clearTimeout(timeout);
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
    try {
      const fastImages = await captureFaceSamples(FACE_LOGIN_SAMPLE_COUNT, {
        updateEnrollmentProgress: false,
      });
      let result = await requestJson<RecognitionResult>("/api/kiosk/recognize-face", {
        method: "POST",
        body: JSON.stringify({ images_base64: fastImages }),
      });

      if (!result.recognized) {
        const retryImages = await captureFaceSamples(FACE_LOGIN_RETRY_SAMPLE_COUNT, {
          updateEnrollmentProgress: false,
        });
        result = await requestJson<RecognitionResult>("/api/kiosk/recognize-face", {
          method: "POST",
          body: JSON.stringify({ images_base64: retryImages }),
        });
      }

      if (result.recognized && result.visitor_id) {
        const foundVisitor = await requestJson<Visitor>(`/api/kiosk/visitors/${result.visitor_id}`);
        setVisitor(foundVisitor);
        await createSession(foundVisitor, "face");
        await loadCurrentBookings(foundVisitor);
      }

      setStep(nextStepAfterRecognition(result.recognized));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Face scan failed.");
    } finally {
      setBusy(false);
    }
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
      const createdVisitor = await requestJson<Visitor>("/api/kiosk/profiles", {
        method: "POST",
        body: JSON.stringify({
          full_name: registration.full_name,
          mobile_number: `${registration.country_code}${normalizeLocalMobileNumber(registration.mobile_number)}`,
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
          <div className="kiosk-content">
            {error ? <StatusBanner tone="error" message={error} /> : null}

            {step === "start" ? (
              <Screen>
                <ScreenTitle title="Welcome to Innovation City" center />
                <p className="screen-copy text-center">Please look at the camera while we check your registration.</p>
                <FaceOrb label={busy ? "SCANNING FACE..." : "READY TO SCAN"} />
                <PrimaryButton disabled={busy} onClick={handleFaceScan}>
                  {busy ? "Scanning..." : "Start Face Scan"}
                </PrimaryButton>
              </Screen>
            ) : null}

            {step === "profile-lookup" ? (
              <Screen>
                <ScreenTitle title="Face Not Recognized" />
                <p className="screen-copy">Please enter your details so we can find your profile.</p>
                <form className="stack" onSubmit={handleProfileLookup}>
                  <Panel>
                    <Field
                      label="Full Name"
                      onChange={(event) => setLookup((value) => ({ ...value, full_name: event.target.value }))}
                      placeholder="Enter your full name"
                      required
                      value={lookup.full_name}
                    />
                    <Field
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
                    <button onClick={handleRegisterLink} type="button">Press here to register.</button>
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
                <PrimaryButton onClick={() => setVoiceOpen(true)} icon={<Mic />}>Start Voice Assistance</PrimaryButton>
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
      {voiceOpen ? (
        <div className="voice-modal">
          <Panel>
            <ScreenTitle title="Voice assistance is starting..." />
            <p className="screen-copy">Use voice assistance as an alternative to typing when the voice service is connected.</p>
            <PrimaryButton onClick={() => setVoiceOpen(false)}>Continue</PrimaryButton>
          </Panel>
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
  return (
    <header className="top-bar">
      <div className="brand">
        <img alt="Innovation City logo" src="/brand/innovation-city-mark.png" />
        <span>INNOVATION CITY</span>
      </div>
    </header>
  );
}

function FooterHelp() {
  return (
    <footer className="footer-help">
      <p>Please ask an Innovation Hub associate if you require assistance.</p>
      <span />
    </footer>
  );
}

function Screen({ children, scroll = false }: { children: React.ReactNode; scroll?: boolean }) {
  return <div className={scroll ? "screen screen-scroll" : "screen"}>{children}</div>;
}

function ScreenTitle({ title, center = false }: { title: string; center?: boolean }) {
  return <h1 className={center ? "screen-title text-center" : "screen-title"}>{title}</h1>;
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
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  leadingAddon?: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className={["input-wrap", leadingAddon ? "with-prefix" : ""].join(" ")}>
        {leadingAddon ? <div className="input-prefix">{leadingAddon}</div> : null}
        <input {...props} />
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

function PageVoiceButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="page-voice-btn" onClick={onClick} type="button">
      <Mic />
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

function VoiceOrb() {
  return (
    <div className="voice-orb">
      <div><Mic /></div>
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
