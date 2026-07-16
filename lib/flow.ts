export type KioskStep =
  | "start"
  | "face-scan"
  | "profile-lookup"
  | "register"
  | "facial-consent"
  | "scan-progress"
  | "welcome-back"
  | "service-selection"
  | "booking"
  | "booking-podcast"
  | "booking-tiktok"
  | "events"
  | "center"
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

export const temporaryRecognitionChoices: Array<{
  id: "recognized" | "not-recognized";
  label: string;
  nextStep: KioskStep;
  simulateMobileNumber?: string;
}> = [
  {
    id: "recognized",
    label: "Face Recognized (Temp)",
    nextStep: nextStepAfterRecognition(true),
    simulateMobileNumber: "+971501234567",
  },
  {
    id: "not-recognized",
    label: "Face Not Recognized (Temp)",
    nextStep: nextStepAfterRecognition(false),
  },
];

export function isBookableService(service: ServiceType): boolean {
  return ["meeting_room", "podcast_studio", "tiktok_studio"].includes(service);
}
