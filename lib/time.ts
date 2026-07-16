const standardBookingDurations = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1 hour 30 minutes" },
  { value: "120", label: "2 hours" },
];

export const OPERATING_HOURS_START = "09:00";
export const OPERATING_HOURS_END = "17:00";
export const LATEST_BOOKING_START = "16:30";
export const OPERATING_HOURS_MESSAGE = "Please choose a time and duration between 9:00 AM and 5:00 PM.";

function minutesFromTime(value: string): number | null {
  const [hours = "", minutes = ""] = value.split(":");
  const parsedHours = Number.parseInt(hours, 10);
  const parsedMinutes = Number.parseInt(minutes, 10);

  if (
    Number.isNaN(parsedHours) ||
    Number.isNaN(parsedMinutes) ||
    parsedHours < 0 ||
    parsedHours > 23 ||
    parsedMinutes < 0 ||
    parsedMinutes > 59
  ) {
    return null;
  }

  return parsedHours * 60 + parsedMinutes;
}

export function bookingDurationOptions(startTime: string) {
  const startMinutes = minutesFromTime(startTime);

  if (startMinutes === null) {
    return standardBookingDurations;
  }

  const openMinutes = minutesFromTime(OPERATING_HOURS_START) ?? 0;
  const closeMinutes = minutesFromTime(OPERATING_HOURS_END) ?? 1440;

  if (startMinutes < openMinutes || startMinutes >= closeMinutes) {
    return [];
  }

  return standardBookingDurations.filter(
    (duration) => startMinutes + Number.parseInt(duration.value, 10) <= closeMinutes
  );
}

export function addMinutesToTime(start: string, durationMinutes: number): string {
  const [hours = "0", minutes = "0"] = start.split(":");
  const totalMinutes =
    Number.parseInt(hours, 10) * 60 +
    Number.parseInt(minutes, 10) +
    durationMinutes;
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const endHours = Math.floor(normalized / 60);
  const endMinutes = normalized % 60;

  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

export function toDateInputValue(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function toTimeInputValue(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

export function isPastDate(dateValue: string, now: Date = new Date()): boolean {
  return dateValue < toDateInputValue(now);
}

export function isPastDateTime(
  dateValue: string,
  timeValue: string,
  now: Date = new Date(),
): boolean {
  const today = toDateInputValue(now);

  if (dateValue < today) {
    return true;
  }

  if (dateValue > today) {
    return false;
  }

  return timeValue < toTimeInputValue(now);
}
