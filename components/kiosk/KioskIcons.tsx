// Line icons matching the Figma kiosk screens: white 1.5px strokes on a
// 24px grid, rendered at 60px with the design's blurred glow copy
// (drop-shadow in .kiosk-icon). To use the exact Figma exports instead,
// swap any of these for <img src="/icons/....svg" className="kiosk-icon" />.
import type { ReactNode } from "react";

function Icon({ children, size = 60 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden
      className="kiosk-icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

/* ---- "What brings you to Innovation City today?" cards ---- */
export const CalendarIcon = () => (
  <Icon>
    <rect x="3" y="4.5" width="18" height="16" rx="4.5" />
    <path d="M8 3v3M16 3v3M3 9.5h18" />
    <circle cx="16" cy="15.5" r="1.3" />
  </Icon>
);
/** Meeting room: three people seated behind a table. */
export const MeetingRoomIcon = () => (
  <Icon>
    <circle cx="12" cy="5.8" r="2.3" />
    <path d="M7.8 13a4.2 4.2 0 0 1 8.4 0" />
    <circle cx="5.2" cy="8.3" r="1.7" />
    <path d="M2.4 13a2.8 2.8 0 0 1 5.3-1.2" />
    <circle cx="18.8" cy="8.3" r="1.7" />
    <path d="M16.3 11.8a2.8 2.8 0 0 1 5.3 1.2" />
    <rect x="1.5" y="13" width="21" height="3" rx="1" />
    <path d="M5 16v4.5M19 16v4.5" />
  </Icon>
);

export const ExploreIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.6 8.4-2 5.2-5.2 2 2-5.2 5.2-2Z" />
    <circle cx="12" cy="12" r="0.9" />
  </Icon>
);
export const EventsIcon = () => (
  <Icon>
    <path d="m12 3.2 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.1l-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.2Z" />
  </Icon>
);
export const BookingIcon = () => (
  <Icon>
    <path d="M12 3 20 9.4V16a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9.4L12 3Z" />
    <circle cx="12" cy="13.6" r="3.6" />
    <circle cx="12" cy="13.6" r="1.3" />
  </Icon>
);
export const TikTokIcon = () => (
  <Icon>
    <path d="M13.5 3h3c.3 2.2 1.8 3.8 4 4.1v3a7.6 7.6 0 0 1-4-1.2v5.9a5.8 5.8 0 1 1-5.8-5.8h.5v3.1h-.5a2.7 2.7 0 1 0 2.8 2.7V3Z" />
  </Icon>
);
export const PodcastIcon = () => (
  <Icon>
    <rect x="3.5" y="9" width="17" height="12" rx="3.5" />
    <path d="M6.5 6h11M9 3h6" />
    <path d="M10.2 17.6V12.4l5-1.1v5.1" />
    <circle cx="9" cy="17.6" r="1.4" />
    <circle cx="14" cy="16.4" r="1.4" />
  </Icon>
);
export const SupportIcon = () => (
  <Icon>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3" y="13" width="4.5" height="6.5" rx="2.2" />
    <rect x="16.5" y="13" width="4.5" height="6.5" rx="2.2" />
    <path d="M18.75 19.5c0 1.4-1.3 2.2-3.2 2.2H13.5" />
    <rect x="10.5" y="20.4" width="3.2" height="2.6" rx="1.3" />
  </Icon>
);

/* ---- "How would you like to continue?" options ---- */
export const IncognitoIcon = () => (
  <Icon>
    <path d="M3 11h18M5 11l1.5-5.2A2 2 0 0 1 8.4 4.3h7.2a2 2 0 0 1 1.9 1.5L19 11" />
    <circle cx="7" cy="16" r="3" />
    <circle cx="17" cy="16" r="3" />
    <path d="M10 16h4" />
  </Icon>
);
export const CreateProfileIcon = () => (
  <Icon>
    <circle cx="10" cy="7.5" r="4" />
    <path d="M3 19.5c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5c0 .8-.7 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 3 19.5Z" />
    <path d="M19.5 3v6M16.5 6h6" />
  </Icon>
);
export const ScanFaceIcon = () => (
  <Icon>
    <path d="M3 8V6.5A3.5 3.5 0 0 1 6.5 3H8M16 3h1.5A3.5 3.5 0 0 1 21 6.5V8M21 16v1.5a3.5 3.5 0 0 1-3.5 3.5H16M8 21H6.5A3.5 3.5 0 0 1 3 17.5V16" />
    <path d="M9 9.5v1M15 9.5v1" />
    <path d="M12 9.5V13h-1" />
    <path d="M9.2 15.4a4 4 0 0 0 5.6 0" />
  </Icon>
);
export const ReportIcon = () => (
  <Icon>
    <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);

/* ---- Bottom bar (drawn a little larger, inside a 160px tap target) ---- */
export const PlanVisitIcon = () => (
  <Icon size={64}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2.2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2" />
    <path d="M17.25 13.5v7.5M13.5 17.25H21" />
  </Icon>
);
export const HomeIcon = () => (
  <Icon size={64}>
    <path d="M3.5 10.2 12 3.5l8.5 6.7-1.6 8.2a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6l-1.6-8.2Z" />
    <path d="M12 15.5v2" />
  </Icon>
);
export const FindPlaceIcon = () => (
  <Icon size={64}>
    <rect x="3" y="3" width="18" height="18" rx="4.5" />
    <path d="M4 20 20 4" />
    <path d="M9 13.2S5.8 10.6 5.8 8.6a3.2 3.2 0 0 1 6.4 0c0 2-3.2 4.6-3.2 4.6Z" />
    <circle cx="9" cy="8.6" r="1" />
  </Icon>
);