/* Wording for the confirmation the visitor sees before the voice assistant changes a booking.

   The assistant asks for approval before create_booking, reschedule_booking and cancel_booking.
   This turns the tool name and its arguments into a short, readable summary instead of raw JSON. */

export type ApprovalRow = { label: string; value: string };

export type ApprovalPrompt = {
  title: string;
  rows: ApprovalRow[];
  confirmLabel: string;
  cancelLabel: string;
};

type Args = Record<string, unknown>;

function parseArgs(raw: unknown): Args {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Args) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Args) : {};
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 8 Oct 2026" from YYYY-MM-DD (fixed wording, the same on every device). Anything else is returned as given. */
export function formatApprovalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const day = new Date(`${value}T00:00:00`);
  if (Number.isNaN(day.getTime())) return value;
  return `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

/** "16:00 – 16:30" from a start time and a length in minutes. */
export function formatApprovalTimes(start: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(start);
  if (!match) return start;
  const from = Number(match[1]) * 60 + Number(match[2]);
  const to = from + minutes;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = (total: number) => `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
  return `${clock(from)} – ${clock(to)}`;
}

export function describeApproval(
  toolName: string,
  rawArgs: unknown,
  roomLabel: (roomKey: string) => string,
): ApprovalPrompt {
  const args = parseArgs(rawArgs);
  const rows: ApprovalRow[] = [];

  if (toolName === "create_booking") {
    if (typeof args.room === "string") rows.push({ label: "Room", value: roomLabel(args.room) });
    if (typeof args.date === "string") rows.push({ label: "Date", value: formatApprovalDate(args.date) });
    if (typeof args.time === "string") {
      rows.push({
        label: "Time",
        value: typeof args.duration_minutes === "number" ? formatApprovalTimes(args.time, args.duration_minutes) : args.time,
      });
    }
    return { title: "Confirm your booking", rows, confirmLabel: "Confirm", cancelLabel: "Cancel" };
  }

  if (toolName === "reschedule_booking") {
    if (args.booking_id !== undefined) rows.push({ label: "Booking", value: `#${String(args.booking_id)}` });
    if (typeof args.date === "string" && args.date) rows.push({ label: "New date", value: formatApprovalDate(args.date) });
    if (typeof args.time === "string" && args.time) {
      rows.push({
        label: "New time",
        value: typeof args.duration_minutes === "number" ? formatApprovalTimes(args.time, args.duration_minutes) : args.time,
      });
    } else if (typeof args.duration_minutes === "number") {
      rows.push({ label: "New length", value: `${args.duration_minutes} minutes` });
    }
    return { title: "Confirm the change", rows, confirmLabel: "Confirm", cancelLabel: "Cancel" };
  }

  if (toolName === "cancel_booking") {
    if (args.booking_id !== undefined) rows.push({ label: "Booking", value: `#${String(args.booking_id)}` });
    // "Cancel" would be ambiguous here (cancel the booking, or cancel this question?).
    return { title: "Cancel this booking?", rows, confirmLabel: "Yes, cancel booking", cancelLabel: "Keep booking" };
  }

  return { title: "Please confirm", rows: [{ label: "Action", value: toolName.replace(/_/g, " ") }], confirmLabel: "Confirm", cancelLabel: "Cancel" };
}
