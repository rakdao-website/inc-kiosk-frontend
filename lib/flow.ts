export type KioskStep =
  | "start"
  | "face-scan"
  | "profile-lookup"
  | "register"
  | "facial-consent"
  | "welcome-back"
  | "service-selection"
  | "booking"
  | "events"
  | "packages"
  | "other"
  | "thank-you";

export type ServiceType =
  | "meeting_room"
  | "podcast_studio"
  | "tiktok_studio"
  | "event"
  | "business_center"
  | "other";

export function nextStepAfterRecognition(recognized: boolean): KioskStep {
  return recognized ? "welcome-back" : "profile-lookup";
}

export function isBookableService(service: ServiceType): boolean {
  return ["meeting_room", "podcast_studio", "tiktok_studio"].includes(service);
}
