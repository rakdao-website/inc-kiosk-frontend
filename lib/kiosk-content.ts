export const centerRoomOptions = [
  {
    title: "Meeting Rooms",
    description: "Private rooms for client meetings, advisory sessions, and partner discussions.",
  },
  {
    title: "Offices",
    description: "Workspace options for teams, founders, and Innovation City clients.",
  },
  {
    title: "Podcast Studio",
    description: "Audio-ready studio for interviews, founder stories, and long-form recording.",
  },
  {
    title: "TikTok Studio",
    description: "Short-form content studio set up for quick social media capture.",
  },
  {
    title: "Business Center",
    description: "CX-guided support for company setup, licenses, and free zone questions.",
  },
] as const;

export const kioskSteps = [
  "start",
  "face-scan",
  "profile-lookup",
  "register",
  "facial-consent",
  "scan-progress",
  "welcome-back",
  "service-selection",
  "booking",
  "booking-podcast",
  "booking-tiktok",
  "events",
  "center",
  "other",
  "thank-you",
] as const;
