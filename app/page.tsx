"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  Camera,
  Check,
  DoorOpen,
  FileText,
  Handshake,
  Mic2,
  MonitorPlay,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { ApiRequestError, requestJson } from "@/lib/api";
import {
  isBookableService,
  nextStepAfterRecognition,
  type KioskStep,
  type ServiceType,
} from "@/lib/flow";
import { KioskButton } from "@/components/kiosk/KioskButton";
import { KioskField, KioskSelect } from "@/components/kiosk/KioskField";
import { KioskShell } from "@/components/kiosk/KioskShell";
import { PackagePromotion } from "@/components/kiosk/PackagePromotion";
import { ServiceCard } from "@/components/kiosk/ServiceCard";
import { VoiceAssistModal } from "@/components/kiosk/VoiceAssistButton";

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
  visitor_id?: number | null;
  is_returning_visitor: boolean;
};

type RecognitionResult = {
  recognized: boolean;
  visitor_id?: number | null;
};

type KioskEvent = {
  event_id: number;
  event_name: string;
  event_date: string;
  event_time_start: string;
  event_time_end: string;
  event_location: string;
  short_description: string;
};

type KioskPackage = {
  package_id: number;
  package_name: string;
  package_description: string;
  price_label?: string | null;
  features: string;
};

type RegistrationForm = {
  full_name: string;
  mobile_number: string;
  email: string;
  visitor_type: "client" | "visitor";
  license_number: string;
  company_name: string;
  company_number: string;
};

const initialRegistration: RegistrationForm = {
  full_name: "",
  mobile_number: "",
  email: "",
  visitor_type: "visitor",
  license_number: "",
  company_name: "",
  company_number: "",
};

const serviceOptions: Array<{
  id: ServiceType;
  title: string;
  detail: string;
  icon: typeof Users;
}> = [
  {
    id: "meeting_room",
    title: "Meeting room",
    detail: "Reserve a room and continue to the map screen for guidance.",
    icon: Users,
  },
  {
    id: "podcast_studio",
    title: "Podcast studio",
    detail: "Book a studio slot for recording support.",
    icon: Mic2,
  },
  {
    id: "tiktok_studio",
    title: "TikTok studio",
    detail: "Create short-form content in a dedicated studio space.",
    icon: MonitorPlay,
  },
  {
    id: "event",
    title: "Event",
    detail: "Check today's events and choose the one you are attending.",
    icon: CalendarDays,
  },
  {
    id: "business_center",
    title: "Business center",
    detail: "Review package options and request CX follow-up.",
    icon: Building2,
  },
  {
    id: "other",
    title: "Other assistance",
    detail: "Get help with company setup, free zone questions, or documents.",
    icon: Handshake,
  },
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function KioskPage() {
  const [step, setStep] = useState<KioskStep>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [visitSession, setVisitSession] = useState<VisitSession | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceType | null>(null);
  const [events, setEvents] = useState<KioskEvent[]>([]);
  const [packages, setPackages] = useState<KioskPackage[]>([]);
  const [lookupForm, setLookupForm] = useState({
    full_name: "",
    mobile_number: "",
  });
  const [registration, setRegistration] =
    useState<RegistrationForm>(initialRegistration);
  const [bookingForm, setBookingForm] = useState({
    booking_date: todayIsoDate(),
    booking_time_start: "10:00",
    duration_minutes: "60",
  });
  const [otherForm, setOtherForm] = useState({
    reason: "start_company",
    notes: "",
  });

  const shellTitle = useMemo(() => {
    const titles: Record<KioskStep, string> = {
      start: "Visitor kiosk",
      "face-scan": "Face check-in",
      "profile-lookup": "Find your profile",
      register: "Create profile",
      "facial-consent": "Facial consent",
      "welcome-back": "Welcome",
      "service-selection": "Select a service",
      booking: "Reserve a space",
      events: "Today's events",
      packages: "Business center",
      other: "Other assistance",
      "thank-you": "Thank you",
    };
    return titles[step];
  }, [step]);

  function resetFlow() {
    setStep("start");
    setBusy(false);
    setError(null);
    setVisitor(null);
    setVisitSession(null);
    setSelectedService(null);
    setLookupForm({ full_name: "", mobile_number: "" });
    setRegistration(initialRegistration);
  }

  async function createSession(
    nextVisitor: Visitor,
    recognitionMethod: "face" | "lookup" | "manual",
  ) {
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

  async function handleFaceScan() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<RecognitionResult>("/api/kiosk/recognize-face", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const nextStep = nextStepAfterRecognition(result.recognized);

      if (result.recognized && result.visitor_id) {
        const foundVisitor = await requestJson<Visitor>(
          `/api/kiosk/visitors/${result.visitor_id}`,
        );
        setVisitor(foundVisitor);
        await createSession(foundVisitor, "face");
      }

      setStep(nextStep);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Face check-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const foundVisitor = await requestJson<Visitor>("/api/kiosk/profile-lookup", {
        method: "POST",
        body: JSON.stringify(lookupForm),
      });
      setVisitor(foundVisitor);
      await createSession(foundVisitor, "lookup");
      setStep("welcome-back");
    } catch (lookupError) {
      if (
        lookupError instanceof ApiRequestError &&
        lookupError.errorCode === "VISITOR_NOT_FOUND"
      ) {
        setRegistration((current) => ({
          ...current,
          full_name: lookupForm.full_name,
          mobile_number: lookupForm.mobile_number,
        }));
        setStep("register");
      } else {
        setError(lookupError instanceof Error ? lookupError.message : "Lookup failed");
      }
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
          ...registration,
          license_number:
            registration.visitor_type === "client"
              ? registration.license_number || null
              : null,
          company_name: registration.company_name || null,
          company_number: registration.company_number || null,
        }),
      });
      setVisitor(createdVisitor);
      setStep("facial-consent");
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "Profile creation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConsent(consentGiven: boolean) {
    if (!visitor) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updatedVisitor = await requestJson<Visitor>("/api/kiosk/facial-consent", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          consent_given: consentGiven,
        }),
      });

      if (consentGiven) {
        await requestJson("/api/kiosk/face-profile", {
          method: "POST",
          body: JSON.stringify({ visitor_id: visitor.visitor_id }),
        });
      }

      setVisitor(updatedVisitor);
      await createSession(updatedVisitor, "manual");
      setStep("service-selection");
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : "Consent failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleServiceSelect(service: ServiceType) {
    setSelectedService(service);
    setError(null);

    if (isBookableService(service)) {
      setStep("booking");
      return;
    }

    if (service === "event") {
      setBusy(true);
      try {
        setEvents(await requestJson<KioskEvent[]>("/api/kiosk/events/today"));
        setStep("events");
      } catch (eventsError) {
        setError(eventsError instanceof Error ? eventsError.message : "Events failed");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (service === "business_center") {
      setBusy(true);
      try {
        setPackages(await requestJson<KioskPackage[]>("/api/kiosk/packages"));
        setStep("packages");
      } catch (packagesError) {
        setError(packagesError instanceof Error ? packagesError.message : "Packages failed");
      } finally {
        setBusy(false);
      }
      return;
    }

    setStep("other");
  }

  async function handleBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visitor || !selectedService || !isBookableService(selectedService)) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/kiosk/bookings", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          visit_session_id: visitSession?.visit_session_id,
          service_type: selectedService,
          booking_date: bookingForm.booking_date,
          booking_time_start: bookingForm.booking_time_start,
          duration_minutes: Number.parseInt(bookingForm.duration_minutes, 10),
        }),
      });
      setStep("thank-you");
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Booking failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleEventSelection(eventId: number) {
    if (!visitor) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/kiosk/events/select", {
        method: "POST",
        body: JSON.stringify({
          visitor_id: visitor.visitor_id,
          visit_session_id: visitSession?.visit_session_id,
          event_id: eventId,
        }),
      });
      setStep("thank-you");
    } catch (selectionError) {
      setError(
        selectionError instanceof Error ? selectionError.message : "Event selection failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleOther(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visitor) {
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
          reason: otherForm.reason,
          notes: otherForm.notes || null,
        }),
      });
      setStep("thank-you");
    } catch (assistError) {
      setError(assistError instanceof Error ? assistError.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KioskShell
      onHome={resetFlow}
      onVoice={() => setVoiceOpen(true)}
      title={shellTitle}
    >
      <VoiceAssistModal open={voiceOpen} onClose={() => setVoiceOpen(false)} />
      <div className="mx-auto w-full max-w-5xl">
        {error ? (
          <div className="mb-5 rounded-md border border-red-300/30 bg-red-500/12 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {step === "start" ? (
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan">
                Check in
              </p>
              <h2 className="mt-4 max-w-3xl text-6xl font-semibold leading-tight">
                Welcome to Innovation City
              </h2>
              <p className="mt-5 max-w-2xl text-xl leading-8 text-white/68">
                Start your visit, find your booking, or request help from the CX team.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <KioskButton
                  disabled={busy}
                  icon={Camera}
                  onClick={() => setStep("face-scan")}
                >
                  Start check-in
                </KioskButton>
                <KioskButton
                  icon={Search}
                  onClick={() => setStep("profile-lookup")}
                  variant="secondary"
                >
                  Find profile
                </KioskButton>
              </div>
            </div>
            <div className="rounded-md border border-cyan/20 bg-white/8 p-6">
              <div className="grid aspect-[4/3] place-items-center rounded-md bg-black/20">
                <img
                  alt="Innovation City dashboard mark"
                  className="h-44 w-44 object-contain"
                  src="/inc-live-dashboard.svg"
                />
              </div>
            </div>
          </div>
        ) : null}

        {step === "face-scan" ? (
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid h-56 w-56 place-items-center rounded-full border border-cyan/30 bg-cyan/10">
              <Camera className="h-24 w-24 text-cyan" />
            </div>
            <h2 className="mt-8 text-4xl font-semibold">Face check-in</h2>
            <p className="mt-4 text-lg leading-8 text-white/66">
              Facial recognition is reserved for the next phase. Continue to profile lookup.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <KioskButton disabled={busy} icon={Camera} onClick={handleFaceScan}>
                Continue
              </KioskButton>
            </div>
          </div>
        ) : null}

        {step === "profile-lookup" ? (
          <form className="mx-auto grid max-w-2xl gap-5" onSubmit={handleLookup}>
            <h2 className="text-4xl font-semibold">Find your profile</h2>
            <KioskField
              label="Full name"
              onChange={(event) =>
                setLookupForm((current) => ({ ...current, full_name: event.target.value }))
              }
              required
              value={lookupForm.full_name}
            />
            <KioskField
              label="Mobile number"
              onChange={(event) =>
                setLookupForm((current) => ({
                  ...current,
                  mobile_number: event.target.value,
                }))
              }
              required
              value={lookupForm.mobile_number}
            />
            <KioskButton disabled={busy} icon={Search} type="submit">
              Search
            </KioskButton>
            <KioskButton
              icon={UserPlus}
              onClick={() => setStep("register")}
              type="button"
              variant="ghost"
            >
              Create new profile
            </KioskButton>
          </form>
        ) : null}

        {step === "register" ? (
          <form className="mx-auto grid max-w-3xl gap-5" onSubmit={handleRegistration}>
            <h2 className="text-4xl font-semibold">Create profile</h2>
            <div className="grid gap-5 md:grid-cols-2">
              <KioskField
                label="Full name"
                onChange={(event) =>
                  setRegistration((current) => ({
                    ...current,
                    full_name: event.target.value,
                  }))
                }
                required
                value={registration.full_name}
              />
              <KioskField
                label="Mobile number"
                onChange={(event) =>
                  setRegistration((current) => ({
                    ...current,
                    mobile_number: event.target.value,
                  }))
                }
                required
                value={registration.mobile_number}
              />
              <KioskField
                label="Email"
                onChange={(event) =>
                  setRegistration((current) => ({ ...current, email: event.target.value }))
                }
                required
                type="email"
                value={registration.email}
              />
              <KioskSelect
                label="Visitor type"
                onChange={(event) =>
                  setRegistration((current) => ({
                    ...current,
                    visitor_type: event.target.value as "client" | "visitor",
                  }))
                }
                options={[
                  { label: "Visitor", value: "visitor" },
                  { label: "Client", value: "client" },
                ]}
                value={registration.visitor_type}
              />
              {registration.visitor_type === "client" ? (
                <>
                  <KioskField
                    label="License number"
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        license_number: event.target.value,
                      }))
                    }
                    value={registration.license_number}
                  />
                  <KioskField
                    label="Company number"
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        company_number: event.target.value,
                      }))
                    }
                    value={registration.company_number}
                  />
                </>
              ) : null}
            </div>
            <KioskField
              label="Company name"
              onChange={(event) =>
                setRegistration((current) => ({
                  ...current,
                  company_name: event.target.value,
                }))
              }
              value={registration.company_name}
            />
            <KioskButton disabled={busy} icon={UserPlus} type="submit">
              Continue
            </KioskButton>
          </form>
        ) : null}

        {step === "facial-consent" ? (
          <div className="mx-auto max-w-3xl">
            <h2 className="text-4xl font-semibold">Save face profile?</h2>
            <p className="mt-4 text-lg leading-8 text-white/68">
              You can use a placeholder enrollment for this phase, or skip it and continue.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <KioskButton disabled={busy} icon={Check} onClick={() => handleConsent(true)}>
                Save placeholder
              </KioskButton>
              <KioskButton
                disabled={busy}
                icon={DoorOpen}
                onClick={() => handleConsent(false)}
                variant="secondary"
              >
                Skip
              </KioskButton>
            </div>
          </div>
        ) : null}

        {step === "welcome-back" ? (
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan">
              {visitSession?.is_returning_visitor ? "Welcome back" : "Welcome"}
            </p>
            <h2 className="mt-3 text-5xl font-semibold">
              {visitor?.visitor_name ?? "Innovation City visitor"}
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/68">
              Continue to choose the service you need today.
            </p>
            <KioskButton
              className="mt-8"
              icon={DoorOpen}
              onClick={() => setStep("service-selection")}
            >
              Select service
            </KioskButton>
          </div>
        ) : null}

        {step === "service-selection" ? (
          <div>
            <h2 className="text-4xl font-semibold">What do you need today?</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {serviceOptions.map((service) => (
                <ServiceCard
                  detail={service.detail}
                  icon={service.icon}
                  key={service.id}
                  onSelect={() => handleServiceSelect(service.id)}
                  title={service.title}
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === "booking" ? (
          <form className="mx-auto grid max-w-2xl gap-5" onSubmit={handleBooking}>
            <h2 className="text-4xl font-semibold">Reserve a space</h2>
            <KioskField
              label="Date"
              onChange={(event) =>
                setBookingForm((current) => ({
                  ...current,
                  booking_date: event.target.value,
                }))
              }
              required
              type="date"
              value={bookingForm.booking_date}
            />
            <KioskField
              label="Start time"
              onChange={(event) =>
                setBookingForm((current) => ({
                  ...current,
                  booking_time_start: event.target.value,
                }))
              }
              required
              type="time"
              value={bookingForm.booking_time_start}
            />
            <KioskField
              label="Duration minutes"
              max="480"
              min="15"
              onChange={(event) =>
                setBookingForm((current) => ({
                  ...current,
                  duration_minutes: event.target.value,
                }))
              }
              required
              type="number"
              value={bookingForm.duration_minutes}
            />
            <KioskButton disabled={busy} type="submit">
              Confirm booking
            </KioskButton>
          </form>
        ) : null}

        {step === "events" ? (
          <div>
            <h2 className="text-4xl font-semibold">Today's events</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {events.length === 0 ? (
                <div className="rounded-md border border-white/14 bg-white/8 p-6 text-white/68">
                  No events are scheduled for today.
                </div>
              ) : null}
              {events.map((eventItem) => (
                <button
                  className="rounded-md border border-white/14 bg-white/8 p-5 text-left transition hover:border-cyan"
                  key={eventItem.event_id}
                  onClick={() => handleEventSelection(eventItem.event_id)}
                  type="button"
                >
                  <span className="block text-xl font-semibold">{eventItem.event_name}</span>
                  <span className="mt-2 block text-sm text-white/64">
                    {eventItem.event_time_start} to {eventItem.event_time_end}
                  </span>
                  <span className="mt-3 block text-sm text-cyan">
                    {eventItem.event_location}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "packages" ? (
          <div>
            <h2 className="text-4xl font-semibold">Business center packages</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {packages.map((item) => (
                <PackagePromotion
                  description={item.package_description}
                  features={item.features}
                  key={item.package_id}
                  name={item.package_name}
                  price={item.price_label}
                />
              ))}
            </div>
            <KioskButton
              className="mt-8"
              icon={FileText}
              onClick={() => {
                setOtherForm({
                  reason: "start_company",
                  notes: "Interested in business center packages",
                });
                setStep("other");
              }}
            >
              Request follow-up
            </KioskButton>
          </div>
        ) : null}

        {step === "other" ? (
          <form className="mx-auto grid max-w-2xl gap-5" onSubmit={handleOther}>
            <h2 className="text-4xl font-semibold">Other assistance</h2>
            <KioskSelect
              label="Reason"
              onChange={(event) =>
                setOtherForm((current) => ({ ...current, reason: event.target.value }))
              }
              options={[
                { label: "Start a company", value: "start_company" },
                { label: "Free zone questions", value: "free_zone_questions" },
                {
                  label: "Document creation or renewal",
                  value: "document_creation_renewal",
                },
              ]}
              value={otherForm.reason}
            />
            <label className="grid gap-2 text-sm font-semibold text-white/80">
              <span>Notes</span>
              <textarea
                className="min-h-32 rounded-md border border-white/16 bg-white/8 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/35 focus:border-cyan"
                onChange={(event) =>
                  setOtherForm((current) => ({ ...current, notes: event.target.value }))
                }
                value={otherForm.notes}
              />
            </label>
            <KioskButton disabled={busy} icon={Handshake} type="submit">
              Send request
            </KioskButton>
          </form>
        ) : null}

        {step === "thank-you" ? (
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-md bg-mint/18 text-mint">
              <Check className="h-12 w-12" />
            </div>
            <h2 className="mt-8 text-5xl font-semibold">You are checked in</h2>
            <p className="mt-5 text-lg leading-8 text-white/68">
              The main map screen can guide you to the right zone.
            </p>
            <KioskButton className="mt-8" icon={DoorOpen} onClick={resetFlow}>
              Finish
            </KioskButton>
          </div>
        ) : null}
      </div>
    </KioskShell>
  );
}
